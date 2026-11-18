import type { PaymentProofConfig } from '../../config/payment-proof.js';
import type { MembershipRequestRepository } from './membership-request.repository.js';
import { PaymentProofFetchFailure, type PaymentProofFetcher } from './payment-proof.fetcher.js';
import { PaymentProofImageFailure, type PaymentProofImageNormalizer } from './payment-proof.image.js';
import { MembershipPaymentProofService } from './payment-proof.service.js';

const canonicalAttachment = 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png';
const config = (enabled = true): PaymentProofConfig => ({ enabled, allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com', bucket: 'yc-fitness-uat', keyPrefix: 'payment-attachments/', maxBytes: 5_242_880, maxPixels: 40_000_000, timeoutMs: 5_000 });
const repository = (attachment: string | null = canonicalAttachment): MembershipRequestRepository => ({
  findPaymentProofContext: vi.fn(async () => attachment === null ? null : { attachment }),
} as unknown as MembershipRequestRepository);
const fetcher = (): PaymentProofFetcher => ({ fetch: vi.fn(async () => ({ bytes: Buffer.from('input'), mediaType: 'image/png' })) });
const normalizer = (): PaymentProofImageNormalizer => ({ normalize: vi.fn(async () => Buffer.from('webp')) });

describe('Membership payment proof service', () => {
  it('fetches only the reconstructed trusted URL and returns normalized bytes', async () => {
    const repo = repository();
    const remote = fetcher();
    const image = normalizer();
    const result = await new MembershipPaymentProofService(repo, config(), remote, image).get(1, 2);
    expect(result).toEqual(Buffer.from('webp'));
    expect(remote.fetch).toHaveBeenCalledWith('https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png');
    expect(remote.fetch).not.toHaveBeenCalledWith(canonicalAttachment);
  });

  it('returns explicit DTO status without leaking the attachment', () => {
    const service = new MembershipPaymentProofService(repository(), config(), fetcher(), normalizer());
    const summary = service.describe(12, { id: 34, attachment: canonicalAttachment });
    expect(summary).toEqual({ hasPaymentProof: true, paymentProofStatus: 'AVAILABLE', paymentProofPath: '/api/admin/v1/membership-requests/12/payments/34/proof' });
    expect(JSON.stringify(summary)).not.toContain('digitaloceanspaces');
  });

  it.each([
    { attachment: null, code: 'PAYMENT_PROOF_NOT_FOUND', statusCode: 404 },
    { attachment: '', code: 'PAYMENT_PROOF_NOT_FOUND', statusCode: 404 },
    { attachment: 'private-storage-key-only', code: 'PAYMENT_PROOF_UNSUPPORTED', statusCode: 422 },
    { attachment: 'http://localhost:3030/public/uploads/payment-attachments/proof.png', code: 'PAYMENT_PROOF_UNSUPPORTED', statusCode: 422 },
  ])('rejects missing, unrelated, local, and legacy values before fetching', async ({ attachment, code, statusCode }) => {
    const repo = repository(attachment);
    const remote = fetcher();
    const service = new MembershipPaymentProofService(repo, config(), remote, normalizer());
    await expect(service.get(1, 2)).rejects.toMatchObject({ code, statusCode });
    expect(remote.fetch).not.toHaveBeenCalled();
  });

  it('fails closed before repository or network access when disabled', async () => {
    const repo = repository();
    const remote = fetcher();
    await expect(new MembershipPaymentProofService(repo, config(false), remote, normalizer()).get(1, 2)).rejects.toMatchObject({ statusCode: 503, code: 'PAYMENT_PROOF_UNAVAILABLE' });
    expect(repo.findPaymentProofContext).not.toHaveBeenCalled();
    expect(remote.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [new PaymentProofFetchFailure('UPSTREAM'), 502, 'PAYMENT_PROOF_UPSTREAM_UNAVAILABLE'],
    [new PaymentProofFetchFailure('TIMEOUT'), 504, 'PAYMENT_PROOF_TIMEOUT'],
    [new PaymentProofFetchFailure('TOO_LARGE'), 422, 'PAYMENT_PROOF_TOO_LARGE'],
    [new PaymentProofFetchFailure('INVALID_CONTENT'), 422, 'PAYMENT_PROOF_INVALID_CONTENT'],
    [new PaymentProofImageFailure('TOO_LARGE'), 422, 'PAYMENT_PROOF_TOO_LARGE'],
    [new PaymentProofImageFailure('INVALID_CONTENT'), 422, 'PAYMENT_PROOF_INVALID_CONTENT'],
  ] as const)('maps value-free fetch/image failures to stable API errors', async (failure, statusCode, code) => {
    const remote: PaymentProofFetcher = { fetch: vi.fn(async () => {
      if (failure instanceof PaymentProofFetchFailure) throw failure;
      return { bytes: Buffer.from('input'), mediaType: 'image/png' };
    }) };
    const image: PaymentProofImageNormalizer = { normalize: vi.fn(async () => {
      if (failure instanceof PaymentProofImageFailure) throw failure;
      return Buffer.from('webp');
    }) };
    const promise = new MembershipPaymentProofService(repository(), config(), remote, image).get(1, 2);
    await expect(promise).rejects.toMatchObject({ statusCode, code });
    await promise.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain(canonicalAttachment);
      expect(JSON.stringify(error)).not.toContain('payment-attachments/');
    });
  });
});
