import type { Logger } from 'pino';

import type { FcmNotificationMessage, FcmSender } from '../../integrations/firebase/firebase-messaging.js';
import { FcmTimeoutError, toFcmDeliveryError } from './fcm-payment-push.errors.js';
import type { PaymentPushMessage, PaymentPushNotificationService } from './payment-push.service.js';

export type FcmPaymentPushOptions = {
  timeoutMs: number;
  now?: () => number;
};

const TIMED_OUT = Symbol('fcm-timeout');

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  // A send that settles after the timeout must not become an unhandled rejection.
  operation.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([operation, timeout]);
    if (result === TIMED_OUT) throw new FcmTimeoutError();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Delivers the post-commit Payment push through FCM with the exact payload the
 * Mobile API sends: `{ token, notification: { title, body } }` and nothing else.
 * One attempt per decision; no retries, because the Payment and Notification
 * rows are already committed and a retry could duplicate the push.
 * Failures are rethrown as sanitized FcmDeliveryError subclasses so the
 * existing PaymentService warning reports a meaningful `failureType`.
 */
export class FcmPaymentPushNotificationService implements PaymentPushNotificationService {
  private readonly now: () => number;

  public constructor(
    private readonly sender: FcmSender,
    private readonly options: FcmPaymentPushOptions,
    private readonly log: Pick<Logger, 'info'>,
  ) {
    this.now = options.now ?? (() => performance.now());
  }

  public async send(message: PaymentPushMessage): Promise<void> {
    const payload: FcmNotificationMessage = {
      token: message.token,
      notification: { title: message.title, body: message.message },
    };
    const startedAt = this.now();

    try {
      await withTimeout(this.sender.send(payload), this.options.timeoutMs);
    } catch (error) {
      throw toFcmDeliveryError(error);
    }

    this.log.info({
      event: 'payment_push',
      outcome: 'sent',
      paymentId: message.paymentId,
      memberId: message.memberId,
      durationMs: Math.round(this.now() - startedAt),
    }, 'Payment push sent');
  }
}
