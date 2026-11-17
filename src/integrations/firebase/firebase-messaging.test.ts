import type { App, AppOptions, Credential } from 'firebase-admin/app';

import { FirebaseServiceAccountCredential, PushConfigurationError } from '../../config/push.js';
import {
  createFirebaseMessagingSender,
  FIREBASE_PUSH_APP_NAME,
  type FirebaseAdminSdk,
} from './firebase-messaging.js';

const PRIVATE_KEY_MARKER = 'FAKE-PRIVATE-KEY-MARKER-do-not-leak';

/** In-memory stand-in for firebase-admin; nothing here touches the network. */
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
    cert: vi.fn(() => ({ kind: 'cert' }) as unknown as Credential),
    applicationDefault: vi.fn(() => ({ kind: 'adc' }) as unknown as Credential),
    getMessaging: vi.fn(() => ({ send })),
  } satisfies FirebaseAdminSdk;
  return { sdk, send, apps };
};

const serviceAccount = () => ({
  source: 'service_account' as const,
  serviceAccount: new FirebaseServiceAccountCredential('fake-project', 'fake@fake-project.iam.gserviceaccount.com', PRIVATE_KEY_MARKER),
});

describe('createFirebaseMessagingSender', () => {
  it('initializes the named app once with cert credentials and reuses it', async () => {
    const { sdk, send } = fakeSdk();
    const first = createFirebaseMessagingSender(sdk, serviceAccount());
    const second = createFirebaseMessagingSender(sdk, serviceAccount());

    expect(sdk.initializeApp).toHaveBeenCalledOnce();
    expect(sdk.initializeApp).toHaveBeenCalledWith({ credential: { kind: 'cert' }, projectId: 'fake-project' }, FIREBASE_PUSH_APP_NAME);
    expect(sdk.cert).toHaveBeenCalledWith({
      projectId: 'fake-project',
      clientEmail: 'fake@fake-project.iam.gserviceaccount.com',
      privateKey: PRIVATE_KEY_MARKER,
    });
    expect(sdk.applicationDefault).not.toHaveBeenCalled();
    expect(sdk.getMessaging).toHaveBeenCalledWith(expect.objectContaining({ name: 'yc-admin-push' }));

    await first.send({ token: 'fake-token', notification: { title: 't', body: 'b' } });
    await second.send({ token: 'fake-token', notification: { title: 't', body: 'b' } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses applicationDefault() with the configured project in ADC mode', () => {
    const { sdk } = fakeSdk();
    createFirebaseMessagingSender(sdk, { source: 'application_default', projectId: 'fake-project' });
    expect(sdk.applicationDefault).toHaveBeenCalledOnce();
    expect(sdk.cert).not.toHaveBeenCalled();
    expect(sdk.initializeApp).toHaveBeenCalledWith({ credential: { kind: 'adc' }, projectId: 'fake-project' }, 'yc-admin-push');
  });

  it('wraps SDK initialization failures in a sanitized configuration error', () => {
    const { sdk } = fakeSdk();
    sdk.cert.mockImplementation(() => {
      throw new Error(`Failed to parse private key: ${PRIVATE_KEY_MARKER}`);
    });
    let caught: unknown;
    try {
      createFirebaseMessagingSender(sdk, serviceAccount());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PushConfigurationError);
    expect((caught as Error).message).toBe('Firebase messaging initialization failed.');
    expect(`${(caught as Error).stack}`).not.toContain(PRIVATE_KEY_MARKER);
    expect(caught).not.toHaveProperty('cause');
  });
});
