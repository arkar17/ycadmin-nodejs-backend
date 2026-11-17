import type { Logger } from 'pino';

import { PushConfigurationError, type PushConfig } from '../../config/push.js';
import {
  createFirebaseMessagingSender,
  loadFirebaseAdminSdk,
  type FirebaseAdminSdk,
} from '../../integrations/firebase/firebase-messaging.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import { DisabledPaymentPushNotificationService, type PaymentPushNotificationService } from './payment-push.service.js';

export type PaymentPushFactoryDependencies = {
  config: PushConfig;
  log: Pick<Logger, 'info'>;
  loadSdk?: () => Promise<FirebaseAdminSdk>;
};

/**
 * Composes the Payment push adapter at startup. Disabled push returns the
 * no-op adapter without loading the Firebase SDK. Enabled push loads the SDK,
 * initializes the named app once, and fails startup with a sanitized
 * PushConfigurationError if that is impossible.
 */
export const createPaymentPushNotificationService = async (
  dependencies: PaymentPushFactoryDependencies,
): Promise<PaymentPushNotificationService> => {
  const { config, log } = dependencies;

  if (!config.enabled) {
    log.info({ event: 'payment_push', outcome: 'disabled' }, 'Payment push notifications are disabled');
    return new DisabledPaymentPushNotificationService();
  }

  let sdk: FirebaseAdminSdk;
  try {
    sdk = await (dependencies.loadSdk ?? loadFirebaseAdminSdk)();
  } catch {
    throw new PushConfigurationError('Firebase Admin SDK could not be loaded.');
  }

  const sender = createFirebaseMessagingSender(sdk, config.credential);
  log.info({
    event: 'payment_push',
    outcome: 'enabled',
    credentialSource: config.credential.source,
    timeoutMs: config.timeoutMs,
  }, 'Payment push notifications are enabled');

  return new FcmPaymentPushNotificationService(sender, { timeoutMs: config.timeoutMs }, log);
};
