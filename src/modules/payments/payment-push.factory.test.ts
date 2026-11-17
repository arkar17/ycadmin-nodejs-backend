import type { App, AppOptions, Credential } from 'firebase-admin/app';

import { FirebaseServiceAccountCredential, PushConfigurationError } from '../../config/push.js';
import type { FirebaseAdminSdk } from '../../integrations/firebase/firebase-messaging.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import { createPaymentPushNotificationService } from './payment-push.factory.js';
import { DisabledPaymentPushNotificationService } from './payment-push.service.js';

const fakeSdk = () => {
  const apps: App[] = [];
  const send = vi.fn(async () => 'projects/fake/messages/1');
  const sdk = {
    initializeApp: vi.fn((options: AppOptions, name: string) => {
      const app = { name, options } as App;
      apps.push(app);
      return app;
    }),
    getApps: vi.fn(() => [...apps]),
    cert: vi.fn(() => ({}) as Credential),
    applicationDefault: vi.fn(() => ({}) as Credential),
    getMessaging: vi.fn(() => ({ send })),
  } satisfies FirebaseAdminSdk;
  return { sdk, send };
};

const log = () => ({ info: vi.fn() });

const enabled = {
  enabled: true as const,
  timeoutMs: 5000,
  credential: {
    source: 'service_account' as const,
    serviceAccount: new FirebaseServiceAccountCredential('fake-project', 'fake@fake-project.iam.gserviceaccount.com', 'FAKE-PRIVATE-KEY-MARKER'),
  },
};

describe('createPaymentPushNotificationService', () => {
  it('returns the disabled adapter, never loads Firebase, and logs once when disabled', async () => {
    const loadSdk = vi.fn(async () => fakeSdk().sdk);
    const logger = log();
    const service = await createPaymentPushNotificationService({ config: { enabled: false }, log: logger, loadSdk });

    expect(service).toBeInstanceOf(DisabledPaymentPushNotificationService);
    expect(loadSdk).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith({ event: 'payment_push', outcome: 'disabled' }, 'Payment push notifications are disabled');
    await expect(service.send({ token: 'fake-token', title: 't', message: 'm', paymentId: 1, memberId: 2 })).resolves.toBeUndefined();
  });

  it('loads the SDK, initializes once, and returns the FCM adapter when enabled', async () => {
    const { sdk, send } = fakeSdk();
    const loadSdk = vi.fn(async () => sdk);
    const logger = log();
    const first = await createPaymentPushNotificationService({ config: enabled, log: logger, loadSdk });
    await createPaymentPushNotificationService({ config: enabled, log: logger, loadSdk });

    expect(first).toBeInstanceOf(FcmPaymentPushNotificationService);
    expect(sdk.initializeApp).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'payment_push', outcome: 'enabled', credentialSource: 'service_account', timeoutMs: 5000 },
      'Payment push notifications are enabled',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/FAKE-PRIVATE-KEY-MARKER|fake@fake-project|fake-project"/);

    await first.send({ token: 'fake-token', title: 'Your payment has been accepted.', message: 'Your payment has been accepted.', paymentId: 1, memberId: 2 });
    expect(send).toHaveBeenCalledWith({
      token: 'fake-token',
      notification: { title: 'Your payment has been accepted.', body: 'Your payment has been accepted.' },
    });
  });

  it('fails startup with a sanitized error when the SDK cannot be loaded', async () => {
    const loadSdk = vi.fn(async () => { throw new Error('Cannot find module firebase-admin at /secret/path'); });
    await expect(createPaymentPushNotificationService({ config: enabled, log: log(), loadSdk }))
      .rejects.toThrow(new PushConfigurationError('Firebase Admin SDK could not be loaded.'));
  });

  it('fails startup with a sanitized error when Firebase initialization fails', async () => {
    const { sdk } = fakeSdk();
    sdk.initializeApp.mockImplementation(() => { throw new Error('FAKE-PRIVATE-KEY-MARKER invalid'); });
    const failure = await createPaymentPushNotificationService({ config: enabled, log: log(), loadSdk: async () => sdk })
      .then(() => null, (error: unknown) => error as Error);
    expect(failure).toBeInstanceOf(PushConfigurationError);
    expect(failure?.message).toBe('Firebase messaging initialization failed.');
    expect(failure?.stack).not.toContain('FAKE-PRIVATE-KEY-MARKER');
  });
});
