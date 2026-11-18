import sharp from 'sharp';

import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { PaymentProofImageFailure, SharpPaymentProofImageNormalizer } from './payment-proof.image.js';

const config = (overrides: Partial<PaymentProofConfig> = {}): PaymentProofConfig => ({
  enabled: true,
  allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
  bucket: 'yc-fitness-uat',
  keyPrefix: 'payment-attachments/',
  maxBytes: 5_242_880,
  maxPixels: 40_000_000,
  timeoutMs: 5_000,
  ...overrides,
});

describe('sharp payment proof image normalizer', () => {
  it('validates magic bytes, strips metadata, and returns normalized WebP', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#ff0000' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const normalized = await new SharpPaymentProofImageNormalizer(config()).normalize({ bytes: jpeg, mediaType: 'image/jpeg' });
    const metadata = await sharp(normalized).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 6, height: 8 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(normalized.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('accepts valid PNG and WebP inputs', async () => {
    const source = sharp({ create: { width: 4, height: 4, channels: 4, background: '#00ff00' } });
    const png = await source.clone().png().toBuffer();
    const webp = await source.clone().webp().toBuffer();
    await expect(new SharpPaymentProofImageNormalizer(config()).normalize({ bytes: png, mediaType: 'image/png' })).resolves.toBeInstanceOf(Buffer);
    await expect(new SharpPaymentProofImageNormalizer(config()).normalize({ bytes: webp, mediaType: 'image/webp' })).resolves.toBeInstanceOf(Buffer);
  });

  it.each([
    { bytes: Buffer.from('<svg><script>alert(1)</script></svg>'), mediaType: 'image/svg+xml' },
    { bytes: Buffer.from('<html>not an image</html>'), mediaType: 'text/html' },
    { bytes: Buffer.from('%PDF-1.7'), mediaType: 'application/pdf' },
    { bytes: Buffer.from('GIF89a'), mediaType: 'image/gif' },
    { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mediaType: 'image/jpeg' },
  ])('rejects unsupported, scripted, or MIME/magic-mismatched content', async (input) => {
    await expect(new SharpPaymentProofImageNormalizer(config()).normalize(input)).rejects.toMatchObject({ kind: 'INVALID_CONTENT' });
  });

  it('rejects malformed and excessive-pixel images', async () => {
    const malformed = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
    await expect(new SharpPaymentProofImageNormalizer(config()).normalize({ bytes: malformed, mediaType: 'image/jpeg' })).rejects.toMatchObject({ kind: 'INVALID_CONTENT' });
    const large = await sharp({ create: { width: 1_100, height: 1_000, channels: 3, background: '#000000' } }).png().toBuffer();
    await expect(new SharpPaymentProofImageNormalizer(config({ maxPixels: 1_000_000 })).normalize({ bytes: large, mediaType: 'image/png' })).rejects.toMatchObject({ kind: 'INVALID_CONTENT' });
  });

  it('returns value-free stable failures', () => {
    const failure = new PaymentProofImageFailure('INVALID_CONTENT');
    expect(failure.message).toBe('Payment proof image validation failed.');
  });
});
