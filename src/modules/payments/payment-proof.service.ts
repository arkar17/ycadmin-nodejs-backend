import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { AppError } from '../../shared/app-error.js';
import type { PaymentProofFetcher } from '../payment-proof/payment-proof.fetcher.js';
import type { PaymentProofImageNormalizer } from '../payment-proof/payment-proof.image.js';
import { SecurePaymentProofService, type PaymentProofSummary } from '../payment-proof/payment-proof.service.js';
import type { PaymentRecord, PaymentRepository } from './payment.repository.js';

const paymentProofPath = (_unused: number, paymentId: number): string =>
  `/api/admin/v1/payments/${paymentId}/proof`;

export class PaymentProofService {
  private readonly shared: SecurePaymentProofService;

  public constructor(
    repository: PaymentRepository,
    config: PaymentProofConfig,
    fetcher: PaymentProofFetcher,
    imageNormalizer: PaymentProofImageNormalizer,
  ) {
    this.shared = new SecurePaymentProofService(
      async (_unused, paymentId) => {
        const context = await repository.findPaymentProofContext(paymentId);
        if (!context) {
          throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Payment was not found.' });
        }
        return context;
      },
      paymentProofPath,
      config,
      fetcher,
      imageNormalizer,
    );
  }

  public describe(payment: Pick<PaymentRecord, 'id' | 'paymentProofAttachment'>): PaymentProofSummary {
    return this.shared.describe(0, { id: payment.id, attachment: payment.paymentProofAttachment });
  }

  public get(paymentId: number): Promise<Buffer> {
    return this.shared.get(0, paymentId);
  }
}
