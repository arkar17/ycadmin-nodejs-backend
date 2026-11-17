// Type-only imports are erased at compile time; the SDK is loaded lazily below.
import type { App, AppOptions, Credential, ServiceAccount } from 'firebase-admin/app';

import { PushConfigurationError, type FirebaseCredentialConfig } from '../../config/push.js';

export const FIREBASE_PUSH_APP_NAME = 'yc-admin-push';

/** The only FCM message shape this service sends: a notification message to one token. */
export type FcmNotificationMessage = {
  token: string;
  notification: { title: string; body: string };
};

export interface FcmSender {
  send(message: FcmNotificationMessage): Promise<string>;
}

/** The subset of firebase-admin used here, injectable so tests never load or call Firebase. */
export type FirebaseAdminSdk = {
  initializeApp(options: AppOptions, name: string): App;
  getApps(): App[];
  cert(serviceAccount: ServiceAccount): Credential;
  applicationDefault(): Credential;
  getMessaging(app: App): { send(message: FcmNotificationMessage): Promise<string> };
};

/** Loads the Admin SDK on demand so disabled push never imports or initializes Firebase. */
export const loadFirebaseAdminSdk = async (): Promise<FirebaseAdminSdk> => {
  const [appModule, messagingModule] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/messaging'),
  ]);
  return {
    initializeApp: appModule.initializeApp,
    getApps: appModule.getApps,
    cert: appModule.cert,
    applicationDefault: appModule.applicationDefault,
    getMessaging: messagingModule.getMessaging,
  };
};

const appOptions = (sdk: FirebaseAdminSdk, credential: FirebaseCredentialConfig): AppOptions => {
  if (credential.source === 'application_default') {
    return { credential: sdk.applicationDefault(), projectId: credential.projectId };
  }
  const certificate = credential.serviceAccount.toCertificate();
  return { credential: sdk.cert(certificate), projectId: certificate.projectId };
};

/**
 * Returns an FCM sender bound to the named `yc-admin-push` app. The SDK app
 * registry is the singleton: an existing named app is reused, so repeated
 * calls initialize Firebase only once. The global default app is never used.
 * Initialization makes no network call; credential problems surface on send.
 */
export const createFirebaseMessagingSender = (
  sdk: FirebaseAdminSdk,
  credential: FirebaseCredentialConfig,
): FcmSender => {
  let messaging: ReturnType<FirebaseAdminSdk['getMessaging']>;
  try {
    const app = sdk.getApps().find((candidate) => candidate.name === FIREBASE_PUSH_APP_NAME)
      ?? sdk.initializeApp(appOptions(sdk, credential), FIREBASE_PUSH_APP_NAME);
    messaging = sdk.getMessaging(app);
  } catch {
    // SDK messages may describe credential contents, so the original is dropped.
    throw new PushConfigurationError('Firebase messaging initialization failed.');
  }

  return { send: (message) => messaging.send(message) };
};
