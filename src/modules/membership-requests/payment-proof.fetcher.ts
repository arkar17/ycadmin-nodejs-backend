import type { PaymentProofConfig } from '../../config/payment-proof.js';

export type PaymentProofFetchFailureKind = 'UPSTREAM' | 'TIMEOUT' | 'TOO_LARGE' | 'INVALID_CONTENT';

export class PaymentProofFetchFailure extends Error {
  public constructor(public readonly kind: PaymentProofFetchFailureKind) {
    super('Payment proof fetch failed.');
    this.name = 'PaymentProofFetchFailure';
  }
}

export type FetchedPaymentProof = { bytes: Buffer; mediaType: string };

export interface PaymentProofFetcher {
  fetch(trustedUrl: string): Promise<FetchedPaymentProof>;
}

const acceptedMediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class HttpPaymentProofFetcher implements PaymentProofFetcher {
  public constructor(
    private readonly config: PaymentProofConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {}

  public async fetch(trustedUrl: string): Promise<FetchedPaymentProof> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImplementation(trustedUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'accept-encoding': 'identity' },
      });
      if (response.status !== 200) throw new PaymentProofFetchFailure('UPSTREAM');

      const contentEncoding = response.headers.get('content-encoding');
      if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') throw new PaymentProofFetchFailure('INVALID_CONTENT');

      const contentLengthValue = response.headers.get('content-length');
      if (contentLengthValue !== null) {
        if (!/^\d+$/.test(contentLengthValue)) throw new PaymentProofFetchFailure('INVALID_CONTENT');
        const contentLength = Number(contentLengthValue);
        if (!Number.isSafeInteger(contentLength)) throw new PaymentProofFetchFailure('INVALID_CONTENT');
        if (contentLength > this.config.maxBytes) throw new PaymentProofFetchFailure('TOO_LARGE');
      }

      const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase();
      if (!acceptedMediaTypes.has(mediaType)) throw new PaymentProofFetchFailure('INVALID_CONTENT');
      if (!response.body) throw new PaymentProofFetchFailure('INVALID_CONTENT');

      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          total += item.value.byteLength;
          if (total > this.config.maxBytes) {
            await reader.cancel();
            throw new PaymentProofFetchFailure('TOO_LARGE');
          }
          chunks.push(Buffer.from(item.value));
        }
      } finally {
        reader.releaseLock();
      }
      return { bytes: Buffer.concat(chunks, total), mediaType };
    } catch (error) {
      if (error instanceof PaymentProofFetchFailure) throw error;
      if (controller.signal.aborted) throw new PaymentProofFetchFailure('TIMEOUT');
      throw new PaymentProofFetchFailure('UPSTREAM');
    } finally {
      clearTimeout(timeout);
    }
  }
}
