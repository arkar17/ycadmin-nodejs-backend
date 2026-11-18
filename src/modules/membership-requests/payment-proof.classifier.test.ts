import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { classifyPaymentProofAttachment, trustedPaymentProofUrl } from './payment-proof.classifier.js';

const config = (enabled = true): PaymentProofConfig => ({
  enabled,
  allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
  bucket: 'yc-fitness-uat',
  keyPrefix: 'payment-attachments/',
  maxBytes: 5_242_880,
  maxPixels: 40_000_000,
  timeoutMs: 5_000,
});
const filename = '123e4567-e89b-42d3-a456-426614174000.png';
const canonical = `https://yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/${filename}`;

describe('payment proof attachment classifier', () => {
  it('accepts only the exact current format and derives a trusted key/URL without returning the stored URL', () => {
    const result = classifyPaymentProofAttachment(canonical, config());
    expect(result).toEqual({ status: 'AVAILABLE', filename, key: `payment-attachments/${filename}` });
    if (result.status !== 'AVAILABLE') throw new Error('Expected available classification.');
    expect(trustedPaymentProofUrl(result, config())).toBe(`https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/${filename}`);
    expect(trustedPaymentProofUrl(result, config())).not.toBe(canonical);
  });

  it('classifies missing and disabled proofs explicitly', () => {
    expect(classifyPaymentProofAttachment('', config())).toEqual({ status: 'MISSING' });
    expect(classifyPaymentProofAttachment('   ', config())).toEqual({ status: 'MISSING' });
    expect(classifyPaymentProofAttachment(canonical, config(false))).toEqual({ status: 'FEATURE_DISABLED' });
  });

  it.each([
    canonical.replace('https:', 'http:'),
    canonical.replace('https:', 'ftp:'),
    `file:///yc-fitness-uat/payment-attachments/${filename}`,
    `https://localhost/yc-fitness-uat/payment-attachments/${filename}`,
    `https://127.0.0.1/yc-fitness-uat/payment-attachments/${filename}`,
    `https://[::1]/yc-fitness-uat/payment-attachments/${filename}`,
    `https://user:pass@yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/${filename}`,
    `https://yc-fitness-uat.sgp1.digitaloceanspaces.com:444/yc-fitness-uat/payment-attachments/${filename}`,
    `${canonical}?download=1`,
    `${canonical}#fragment`,
    canonical.replace('yc-fitness-uat.sgp1', 'evil.sgp1'),
    canonical.replace('/yc-fitness-uat/', '/other-bucket/'),
    canonical.replace('/payment-attachments/', '/payment-attachments-evil/'),
    canonical.replace('/payment-attachments/', '/payment-attachments//'),
    canonical.replace('/payment-attachments/', '/payment-attachments/%2e%2e/'),
    canonical.replace('/payment-attachments/', '/payment-attachments/%2F/'),
    canonical.replace('/payment-attachments/', '/payment-attachments/%5C/'),
    canonical.replace('/payment-attachments/', '/payment-attachments\\'),
    canonical.replace(filename, `extra/${filename}`),
    canonical.replace(filename, 'not-a-uuid.png'),
    canonical.replace('.png', '.svg'),
    canonical.replace('.png', '.gif'),
    canonical.replace('.png', '.png '),
    ` http${canonical.slice(4)}`,
    'http://localhost:3030/public/uploads/payment-attachments/file.png',
    'private-storage-key-only',
    `data:image/png;base64,${Buffer.from('image').toString('base64')}`,
  ])('rejects unsupported value without producing a target: %s', (value) => {
    expect(classifyPaymentProofAttachment(value, config())).toEqual({ status: 'UNSUPPORTED_FORMAT' });
  });

  it('rejects overlong and control-character values', () => {
    expect(classifyPaymentProofAttachment(`https://${'a'.repeat(2_100)}`, config())).toEqual({ status: 'UNSUPPORTED_FORMAT' });
    expect(classifyPaymentProofAttachment(`${canonical}\n`, config())).toEqual({ status: 'UNSUPPORTED_FORMAT' });
  });
});
