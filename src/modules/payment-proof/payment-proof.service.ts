import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { AppError } from '../../shared/app-error.js';
import { classifyPaymentProofAttachment, trustedPaymentProofUrl, type PaymentProofStatus } from './payment-proof.classifier.js';
import { PaymentProofFetchFailure, type PaymentProofFetcher } from './payment-proof.fetcher.js';
import { PaymentProofImageFailure, type PaymentProofImageNormalizer } from './payment-proof.image.js';

export type PaymentProofContext = { attachment: string };
export type PaymentProofContextResolver = (requestId: number, paymentId: number) => Promise<PaymentProofContext | null>;
export type PaymentProofPathBuilder = (requestId: number, paymentId: number) => string;
export type PaymentProofSummary = { hasPaymentProof: boolean; paymentProofStatus: PaymentProofStatus; paymentProofPath?: string };

const proofError = (statusCode: number, code: string, message: string) => new AppError({ statusCode, code, message });

export class SecurePaymentProofService {
  public constructor(
    private readonly resolveContext: PaymentProofContextResolver,
    private readonly pathFor: PaymentProofPathBuilder,
    private readonly config: PaymentProofConfig,
    private readonly fetcher: PaymentProofFetcher,
    private readonly imageNormalizer: PaymentProofImageNormalizer,
  ) {}

  public describe(requestId: number, payment: { id: number; attachment: string }): PaymentProofSummary {
    const classification = classifyPaymentProofAttachment(payment.attachment, this.config);
    return {
      hasPaymentProof: payment.attachment.trim().length > 0,
      paymentProofStatus: classification.status,
      ...(classification.status === 'AVAILABLE' ? { paymentProofPath: this.pathFor(requestId, payment.id) } : {}),
    };
  }

  public async get(requestId: number, paymentId: number): Promise<Buffer> {
    if (!this.config.enabled) throw proofError(503, 'PAYMENT_PROOF_UNAVAILABLE', 'Payment proof viewing is unavailable.');
    const context = await this.resolveContext(requestId, paymentId);
    if (!context) throw proofError(404, 'PAYMENT_PROOF_NOT_FOUND', 'Payment proof was not found.');
    const classification = classifyPaymentProofAttachment(context.attachment, this.config);
    if (classification.status === 'MISSING') throw proofError(404, 'PAYMENT_PROOF_NOT_FOUND', 'Payment proof was not found.');
    if (classification.status !== 'AVAILABLE') throw proofError(422, 'PAYMENT_PROOF_UNSUPPORTED', 'Payment proof storage format is unsupported.');
    try {
      const fetched = await this.fetcher.fetch(trustedPaymentProofUrl(classification, this.config));
      return await this.imageNormalizer.normalize(fetched);
    } catch (error) {
      if (error instanceof PaymentProofFetchFailure) {
        if (error.kind === 'TIMEOUT') throw proofError(504, 'PAYMENT_PROOF_TIMEOUT', 'Payment proof retrieval timed out.');
        if (error.kind === 'TOO_LARGE') throw proofError(422, 'PAYMENT_PROOF_TOO_LARGE', 'Payment proof exceeds the allowed size.');
        if (error.kind === 'INVALID_CONTENT') throw proofError(422, 'PAYMENT_PROOF_INVALID_CONTENT', 'Payment proof content is invalid.');
        throw proofError(502, 'PAYMENT_PROOF_UPSTREAM_UNAVAILABLE', 'Payment proof storage is unavailable.');
      }
      if (error instanceof PaymentProofImageFailure) {
        if (error.kind === 'TOO_LARGE') throw proofError(422, 'PAYMENT_PROOF_TOO_LARGE', 'Payment proof exceeds the allowed size.');
        throw proofError(422, 'PAYMENT_PROOF_INVALID_CONTENT', 'Payment proof content is invalid.');
      }
      throw error;
    }
  }
}
