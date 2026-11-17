import { PaymentStatus } from '@prisma/client';
import pino from 'pino';

import { loggerRedaction } from '../../config/logger.js';
import type { FcmSender } from '../../integrations/firebase/firebase-messaging.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import { DisabledPaymentPushNotificationService } from './payment-push.service.js';
import type { PaymentDecisionResult, PaymentRecord, PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';

const FAKE_TOKEN = 'fake-fcm-token-must-never-be-logged-456';
const PRIVATE_KEY_MARKER = 'FAKE-PRIVATE-KEY-MARKER-do-not-leak';
const ACCEPTED = 'Your payment has been accepted.';
const DECLINED = 'Your payment has been declined.';

const date = new Date('2026-11-17T00:00:00.000Z');
const payment = (status: PaymentStatus) => ({
  id: 7,
  name: 'YC/26/000007',
  memberId: 20,
  requestType: 'MEMBER_PLAN_UPGRADE',
  amount: 30_000,
  requestDate: date,
  status,
  approvedAt: status === PaymentStatus.ACCEPT ? date : null,
  approvedBy: status === PaymentStatus.ACCEPT ? { id: 1, name: 'Admin' } : null,
  cancelledAt: status === PaymentStatus.DECLINE ? date : null,
  cancelledBy: status === PaymentStatus.DECLINE ? { id: 1, name: 'Admin' } : null,
  cancelledReason: status === PaymentStatus.DECLINE ? 'Invalid proof' : null,
  member: { id: 20, name: 'Member', code: 'YC0020' },
  memberPlan: null,
  memberType: null,
  shopLevel: null,
  bankInformation: null,
  memberRequest: null,
  shopUpgradeRequest: null,
  hasPaymentProof: true,
  createdAt: date,
  updatedAt: date,
}) as unknown as PaymentRecord;

/** Mirrors the repository contract: the decision and Notification row are committed before push. */
const repository = (result: Partial<PaymentDecisionResult> = {}): PaymentRepository => ({
  findPage: vi.fn(),
  findById: vi.fn(),
  decide: vi.fn(async (input) => {
    const accepted = input.decision === 'accept';
    const text = accepted ? ACCEPTED : DECLINED;
    return {
      changed: true,
      payment: payment(accepted ? PaymentStatus.ACCEPT : PaymentStatus.DECLINE),
      pushTarget: { token: FAKE_TOKEN, title: text, message: text },
      ...result,
    };
  }),
});

const capturedLogger = () => {
  const lines: string[] = [];
  const log = pino({ level: 'trace', redact: loggerRedaction }, { write: (line: string) => { lines.push(line); } });
  return { log, lines, text: () => lines.join('\n') };
};

const failingSender = (code: string): FcmSender & { send: ReturnType<typeof vi.fn> } => ({
  send: vi.fn(async () => {
    throw Object.assign(new Error(`rejected ${FAKE_TOKEN} ${PRIVATE_KEY_MARKER}`), { code });
  }),
});

describe('PaymentService with the FCM adapter', () => {
  it.each([
    ['accept', ACCEPTED, PaymentStatus.ACCEPT],
    ['decline', DECLINED, PaymentStatus.DECLINE],
  ] as const)('sends the exact %s payload after commit', async (decision, text, status) => {
    const sender = { send: vi.fn(async () => 'projects/fake/messages/1') };
    const { log, text: logs } = capturedLogger();
    const service = new PaymentService(repository(), new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, log), log);

    const result = decision === 'accept'
      ? await service.accept(7, 1, 'req-1')
      : await service.decline(7, 1, 'Invalid proof', 'req-1');

    expect(result).toMatchObject({ changed: true, payment: { id: 7, status } });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(sender.send).toHaveBeenCalledWith({ token: FAKE_TOKEN, notification: { title: text, body: text } });
    expect(logs()).not.toContain(FAKE_TOKEN);
  });

  it.each([
    ['messaging/registration-token-not-registered', 'FcmTokenInvalidError'],
    ['messaging/third-party-auth-error', 'FcmCredentialError'],
    ['messaging/invalid-argument', 'FcmProviderRejectedError'],
    ['messaging/server-unavailable', 'FcmTransientError'],
  ])('keeps the committed decision when FCM fails with %s and warns safely', async (code, failureType) => {
    const repo = repository();
    const sender = failingSender(code);
    const { log, lines, text } = capturedLogger();
    const service = new PaymentService(repo, new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, log), log);

    const result = await service.accept(7, 1, 'req-2');

    expect(result).toMatchObject({ changed: true, payment: { id: 7, status: PaymentStatus.ACCEPT } });
    expect(repo.decide).toHaveBeenCalledOnce();
    expect(sender.send).toHaveBeenCalledOnce();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 40,
      failureType,
      requestId: 'req-2',
      paymentId: 7,
      memberId: 20,
      msg: 'Payment push delivery failed after commit',
    });
    expect(text()).not.toContain(FAKE_TOKEN);
    expect(text()).not.toContain(PRIVATE_KEY_MARKER);
    expect(text()).not.toContain('rejected');
  });

  it('does not send push when the decision did not change', async () => {
    const sender = { send: vi.fn(async () => 'unused') };
    const { log } = capturedLogger();
    const repo = repository({ changed: false, pushTarget: null });
    const service = new PaymentService(repo, new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, log), log);

    const result = await service.accept(7, 1, 'req-3');

    expect(result.changed).toBe(false);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('does not send push when the member has no FCM token', async () => {
    const sender = { send: vi.fn(async () => 'unused') };
    const { log } = capturedLogger();
    const service = new PaymentService(repository({ pushTarget: null }), new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, log), log);
    await service.accept(7, 1, 'req-4');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('the disabled adapter sends nothing and the decision still succeeds', async () => {
    const { log, lines } = capturedLogger();
    const disabled = new DisabledPaymentPushNotificationService();
    const send = vi.spyOn(disabled, 'send');
    const service = new PaymentService(repository(), disabled, log);

    const result = await service.accept(7, 1, 'req-5');

    expect(result.changed).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    await expect(send.mock.results[0]!.value).resolves.toBeUndefined();
    expect(lines).toHaveLength(0);
  });
});
