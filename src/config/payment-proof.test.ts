import { paymentProofConfigFromEnvironment, type PaymentProofEnvironment } from './payment-proof.js';

const validEnvironment = (overrides: Partial<PaymentProofEnvironment> = {}): PaymentProofEnvironment => ({
  PAYMENT_PROOF_ENABLED: false,
  PAYMENT_PROOF_ALLOWED_ORIGIN: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
  PAYMENT_PROOF_BUCKET: 'yc-fitness-uat',
  PAYMENT_PROOF_KEY_PREFIX: 'payment-attachments/',
  PAYMENT_PROOF_MAX_BYTES: 5_242_880,
  PAYMENT_PROOF_MAX_PIXELS: 40_000_000,
  PAYMENT_PROOF_TIMEOUT_MS: 5_000,
  ...overrides,
});

describe('payment proof configuration', () => {
  it('accepts the exact approved disabled-by-default contract', () => {
    expect(paymentProofConfigFromEnvironment(validEnvironment())).toEqual({
      enabled: false,
      allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
      bucket: 'yc-fitness-uat',
      keyPrefix: 'payment-attachments/',
      maxBytes: 5_242_880,
      maxPixels: 40_000_000,
      timeoutMs: 5_000,
    });
  });

  it.each([
    ['http://yc-fitness-uat.sgp1.digitaloceanspaces.com', 'HTTPS'],
    ['https://user@yc-fitness-uat.sgp1.digitaloceanspaces.com', 'credentials'],
    ['https://yc-fitness-uat.sgp1.digitaloceanspaces.com:444', 'port'],
    ['https://yc-fitness-uat.sgp1.digitaloceanspaces.com:443', 'only the origin'],
    ['https://yc-fitness-uat.sgp1.digitaloceanspaces.com/path', 'only the origin'],
    ['https://yc-fitness-uat.sgp1.digitaloceanspaces.com?x=1', 'query'],
    ['https://127.0.0.1', 'local or IP'],
    ['https://localhost', 'local or IP'],
    ['https://proof.local', 'local or IP'],
    ['https://evil.example', 'not approved'],
  ])('rejects unsafe origin %s', (origin, message) => {
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_ALLOWED_ORIGIN: origin }))).toThrow(message);
  });

  it('rejects unapproved bucket/prefix and numeric values outside strict bounds', () => {
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_BUCKET: 'other' }))).toThrow('PAYMENT_PROOF_BUCKET');
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_KEY_PREFIX: '../' }))).toThrow('PAYMENT_PROOF_KEY_PREFIX');
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_MAX_BYTES: 100 }))).toThrow('PAYMENT_PROOF_MAX_BYTES');
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_MAX_PIXELS: 999_999 }))).toThrow('PAYMENT_PROOF_MAX_PIXELS');
    expect(() => paymentProofConfigFromEnvironment(validEnvironment({ PAYMENT_PROOF_TIMEOUT_MS: 99 }))).toThrow('PAYMENT_PROOF_TIMEOUT_MS');
  });
});
