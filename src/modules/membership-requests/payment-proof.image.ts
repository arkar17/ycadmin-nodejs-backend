import sharp from 'sharp';

import type { PaymentProofConfig } from '../../config/payment-proof.js';
import type { FetchedPaymentProof } from './payment-proof.fetcher.js';

export type PaymentProofImageFailureKind = 'TOO_LARGE' | 'INVALID_CONTENT';

export class PaymentProofImageFailure extends Error {
  public constructor(public readonly kind: PaymentProofImageFailureKind) {
    super('Payment proof image validation failed.');
    this.name = 'PaymentProofImageFailure';
  }
}

export interface PaymentProofImageNormalizer {
  normalize(input: FetchedPaymentProof): Promise<Buffer>;
}

const detectedMediaType = (bytes: Buffer): string | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
};

export class SharpPaymentProofImageNormalizer implements PaymentProofImageNormalizer {
  public constructor(private readonly config: PaymentProofConfig) {}

  public async normalize(input: FetchedPaymentProof): Promise<Buffer> {
    if (input.bytes.length === 0 || input.bytes.length > this.config.maxBytes) throw new PaymentProofImageFailure(input.bytes.length > this.config.maxBytes ? 'TOO_LARGE' : 'INVALID_CONTENT');
    const magicMediaType = detectedMediaType(input.bytes);
    if (!magicMediaType || magicMediaType !== input.mediaType) throw new PaymentProofImageFailure('INVALID_CONTENT');

    try {
      const image = sharp(input.bytes, {
        failOn: 'error',
        limitInputPixels: this.config.maxPixels,
        sequentialRead: true,
        animated: false,
      });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > this.config.maxPixels) throw new PaymentProofImageFailure('INVALID_CONTENT');
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new PaymentProofImageFailure('INVALID_CONTENT');

      const normalized = await image.rotate().webp({ quality: 90, effort: 4 }).toBuffer();
      if (normalized.length > this.config.maxBytes) throw new PaymentProofImageFailure('TOO_LARGE');
      return normalized;
    } catch (error) {
      if (error instanceof PaymentProofImageFailure) throw error;
      throw new PaymentProofImageFailure('INVALID_CONTENT');
    }
  }
}
