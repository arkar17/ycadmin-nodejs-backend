export type PaymentPushMessage = {
  token: string;
  title: string;
  message: string;
  paymentId: number;
  memberId: number;
};

export interface PaymentPushNotificationService {
  send(message: PaymentPushMessage): Promise<void>;
}

/**
 * The Admin service currently has no approved FCM credentials or SDK. This
 * adapter keeps the post-commit boundary explicit without inventing delivery
 * configuration. A real adapter can replace it through router dependencies.
 */
export class DisabledPaymentPushNotificationService implements PaymentPushNotificationService {
  public async send(_message: PaymentPushMessage): Promise<void> {
    // Intentionally unavailable until an approved push integration is supplied.
  }
}
