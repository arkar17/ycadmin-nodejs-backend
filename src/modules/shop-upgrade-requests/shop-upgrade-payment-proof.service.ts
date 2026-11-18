import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { SecurePaymentProofService, type PaymentProofSummary } from '../payment-proof/payment-proof.service.js';
import type { PaymentProofFetcher } from '../payment-proof/payment-proof.fetcher.js';
import type { PaymentProofImageNormalizer } from '../payment-proof/payment-proof.image.js';
import type { ShopUpgradeRequestRepository } from './shop-upgrade-request.repository.js';
export const shopUpgradePaymentProofPath = (requestId: number, paymentId: number) => `/api/admin/v1/shop-upgrade-requests/${requestId}/payments/${paymentId}/proof`;
export class ShopUpgradePaymentProofService {
  private readonly shared: SecurePaymentProofService;
  public constructor(repository: ShopUpgradeRequestRepository, config: PaymentProofConfig, fetcher: PaymentProofFetcher, normalizer: PaymentProofImageNormalizer) { this.shared = new SecurePaymentProofService((requestId, paymentId) => repository.findPaymentProofContext(requestId, paymentId), shopUpgradePaymentProofPath, config, fetcher, normalizer); }
  public describe(requestId: number, payment: { id: number; attachment: string }): PaymentProofSummary { return this.shared.describe(requestId, payment); }
  public get(requestId: number, paymentId: number): Promise<Buffer> { return this.shared.get(requestId, paymentId); }
}
