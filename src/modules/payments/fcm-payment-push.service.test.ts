import { inspect } from 'node:util';

import pino from 'pino';

import { loggerRedaction } from '../../config/logger.js';
import type { FcmNotificationMessage, FcmSender } from '../../integrations/firebase/firebase-messaging.js';
import {
  FcmCredentialError,
  FcmDeliveryError,
  FcmProviderRejectedError,
  FcmTimeoutError,
  FcmTokenInvalidError,
  FcmTransientError,
  FcmUnknownError,
} from './fcm-payment-push.errors.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import type { PaymentPushMessage } from './payment-push.service.js';

const FAKE_TOKEN = 'fake-fcm-token-must-never-be-logged-123';
const PRIVATE_KEY_MARKER = 'FAKE-PRIVATE-KEY-MARKER-do-not-leak';
const ACCEPTED = 'Your payment has been accepted.';
const DECLINED = 'Your payment has been declined.';

const capturedLogger = () => {
  const lines: string[] = [];
  const log = pino({ level: 'trace', redact: loggerRedaction }, { write: (line: string) => { lines.push(line); } });
  return { log, lines, text: () => lines.join('\n') };
};

const message = (text = ACCEPTED): PaymentPushMessage => ({
  token: FAKE_TOKEN,
  title: text,
  message: text,
  paymentId: 7,
  memberId: 20,
});

/** Simulates a firebase-admin error: a code plus a message that echoes sensitive input. */
const providerError = (code?: string) => Object.assign(
  new Error(`Provider failure for ${FAKE_TOKEN} using ${PRIVATE_KEY_MARKER}`),
  code ? { code, errorInfo: { code, message: FAKE_TOKEN } } : {},
);

const sender = (implementation: FcmSender['send'] = async () => 'projects/fake/messages/1') => ({
  send: vi.fn(implementation),
});

const adapter = (fake: FcmSender, log = capturedLogger().log, timeoutMs = 5000) =>
  new FcmPaymentPushNotificationService(fake, { timeoutMs }, log);

const failureFrom = async (code: string | undefined): Promise<FcmDeliveryError> => {
  const fake = sender(async () => { throw providerError(code); });
  const result = await adapter(fake).send(message()).then(() => null, (error: unknown) => error);
  expect(result).toBeInstanceOf(FcmDeliveryError);
  return result as FcmDeliveryError;
};

describe('FcmPaymentPushNotificationService', () => {
  it.each([
    ['ACCEPT', ACCEPTED],
    ['DECLINE', DECLINED],
  ])('sends the exact mobile-compatible payload for %s', async (_decision, text) => {
    const fake = sender();
    await adapter(fake).send(message(text));

    expect(fake.send).toHaveBeenCalledOnce();
    const payload = fake.send.mock.calls[0]![0] as FcmNotificationMessage & Record<string, unknown>;
    expect(payload).toStrictEqual({ token: FAKE_TOKEN, notification: { title: text, body: text } });
    expect(Object.keys(payload).sort()).toEqual(['notification', 'token']);
    expect(Object.keys(payload.notification).sort()).toEqual(['body', 'title']);
    expect(payload).not.toHaveProperty('data');
    expect(payload).not.toHaveProperty('android');
    expect(payload).not.toHaveProperty('apns');
    expect(JSON.stringify(payload)).not.toMatch(/paymentId|memberId|res_id|resId|model|"type"/);
  });

  it('logs a safe structured success event without the token', async () => {
    const { log, lines, text } = capturedLogger();
    let now = 100;
    const service = new FcmPaymentPushNotificationService(sender(), { timeoutMs: 5000, now: () => (now += 12) }, log);
    await service.send(message());

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 30,
      event: 'payment_push',
      outcome: 'sent',
      paymentId: 7,
      memberId: 20,
      durationMs: 12,
      msg: 'Payment push sent',
    });
    expect(text()).not.toContain(FAKE_TOKEN);
  });

  it.each([
    ['messaging/registration-token-not-registered', FcmTokenInvalidError],
    ['messaging/invalid-registration-token', FcmTokenInvalidError],
    ['messaging/mismatched-credential', FcmCredentialError],
    ['messaging/third-party-auth-error', FcmCredentialError],
    ['messaging/authentication-error', FcmCredentialError],
    ['app/invalid-credential', FcmCredentialError],
    ['messaging/invalid-argument', FcmProviderRejectedError],
    ['messaging/invalid-payload', FcmProviderRejectedError],
    ['messaging/payload-size-limit-exceeded', FcmProviderRejectedError],
    ['messaging/internal-error', FcmTransientError],
    ['messaging/server-unavailable', FcmTransientError],
    ['messaging/unavailable', FcmTransientError],
    ['messaging/quota-exceeded', FcmTransientError],
    ['messaging/message-rate-exceeded', FcmTransientError],
    ['app/network-error', FcmTransientError],
    ['app/network-timeout', FcmTransientError],
    ['ECONNRESET', FcmTransientError],
    ['ETIMEDOUT', FcmTransientError],
    ['messaging/some-future-code', FcmUnknownError],
  ])('maps %s to %s with only safe information', async (code, expected) => {
    const error = await failureFrom(code);
    expect(error).toBeInstanceOf(expected);
    expect(error.name).toBe(expected.name);
    expect(error.providerCode).toBe(code);
    expect(error).not.toHaveProperty('cause');
    const exposed = [error.message, error.stack ?? '', inspect(error, { depth: 10 }), JSON.stringify(error)].join('\n');
    expect(exposed).not.toContain(FAKE_TOKEN);
    expect(exposed).not.toContain(PRIVATE_KEY_MARKER);
    expect(exposed).not.toContain('Provider failure');
  });

  it('maps errors without a safe code to FcmUnknownError and drops unsafe codes', async () => {
    expect(await failureFrom(undefined)).toBeInstanceOf(FcmUnknownError);
    const unsafe = await failureFrom(`messaging/${FAKE_TOKEN} with spaces`);
    expect(unsafe).toBeInstanceOf(FcmUnknownError);
    expect(unsafe.providerCode).toBeUndefined();
  });

  it('times out with FcmTimeoutError, sends once, and swallows the late provider rejection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let rejectLate: (error: unknown) => void = () => undefined;
      const fake = sender(() => new Promise<string>((_resolve, reject) => { rejectLate = reject; }));
      const pending = adapter(fake, capturedLogger().log, 500).send(message()).then(() => null, (error: unknown) => error);

      await vi.advanceTimersByTimeAsync(500);
      const error = await pending;
      expect(error).toBeInstanceOf(FcmTimeoutError);
      expect((error as Error).name).toBe('FcmTimeoutError');
      expect(fake.send).toHaveBeenCalledOnce();

      rejectLate(providerError('messaging/internal-error'));
      await vi.advanceTimersByTimeAsync(0);
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      vi.useRealTimers();
    }
  });

  it('does not log anything on failure (the PaymentService owns the warning)', async () => {
    const { log, lines } = capturedLogger();
    const fake = sender(async () => { throw providerError('messaging/internal-error'); });
    await expect(adapter(fake, log).send(message())).rejects.toBeInstanceOf(FcmTransientError);
    expect(lines).toHaveLength(0);
  });
});

describe('logger redaction', () => {
  it('censors token and credential shaped fields if they are ever logged', () => {
    const { log, text } = capturedLogger();
    log.info({
      token: FAKE_TOKEN,
      pushTarget: { token: FAKE_TOKEN },
      result: { pushTarget: { token: FAKE_TOKEN } },
      message: { token: FAKE_TOKEN },
      private_key: PRIVATE_KEY_MARKER,
      config: { private_key: PRIVATE_KEY_MARKER, privateKey: PRIVATE_KEY_MARKER, credential: PRIVATE_KEY_MARKER },
      credential: PRIVATE_KEY_MARKER,
    }, 'redaction probe');
    expect(text()).not.toContain(FAKE_TOKEN);
    expect(text()).not.toContain(PRIVATE_KEY_MARKER);
    expect(text()).toContain('[REDACTED]');
  });
});
