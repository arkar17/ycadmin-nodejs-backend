import type { PaymentProofConfig } from '../../config/payment-proof.js';
import type { MembershipRequestPaymentRecord, MembershipRequestRepository } from './membership-request.repository.js';
import { paymentProofPath } from './payment-proof.classifier.js';
import type { PaymentProofFetcher } from './payment-proof.fetcher.js';
import type { PaymentProofImageNormalizer } from './payment-proof.image.js';
import { SecurePaymentProofService, type PaymentProofSummary } from '../payment-proof/payment-proof.service.js';

export type { PaymentProofSummary } from '../payment-proof/payment-proof.service.js';

export class MembershipPaymentProofService {
  private readonly shared: SecurePaymentProofService;
  public constructor(
    repository: MembershipRequestRepository,
    config: PaymentProofConfig,
    fetcher: PaymentProofFetcher,
    imageNormalizer: PaymentProofImageNormalizer,
  ) {
    this.shared = new SecurePaymentProofService(
      (requestId, paymentId) => repository.findPaymentProofContext(requestId, paymentId),
      paymentProofPath,
      config,
      fetcher,
      imageNormalizer,
    );
  }

  public describe(requestId: number, payment: Pick<MembershipRequestPaymentRecord, 'id' | 'attachment'>): PaymentProofSummary {
    return this.shared.describe(requestId, payment);
  }

  public async get(requestId: number, paymentId: number): Promise<Buffer> {
    return this.shared.get(requestId, paymentId);
  }
}
