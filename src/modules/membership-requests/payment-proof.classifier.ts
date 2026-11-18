import type { PaymentProofConfig } from '../../config/payment-proof.js';

export const PAYMENT_PROOF_URL_MAX_LENGTH = 2_048;

export type PaymentProofStatus = 'AVAILABLE' | 'MISSING' | 'UNSUPPORTED_FORMAT' | 'FEATURE_DISABLED';
export type PaymentProofClassification =
  | { status: 'AVAILABLE'; filename: string; key: string }
  | { status: Exclude<PaymentProofStatus, 'AVAILABLE'> };

const uuidV4ImageFilename = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/;
const unsafeControlCharacter = /[\u0000-\u001f\u007f]/;

export const classifyPaymentProofAttachment = (
  attachment: string | null | undefined,
  config: PaymentProofConfig,
): PaymentProofClassification => {
  if (attachment === null || attachment === undefined || attachment.trim().length === 0) return { status: 'MISSING' };
  if (attachment !== attachment.trim()) return { status: 'UNSUPPORTED_FORMAT' };
  if (attachment.length > PAYMENT_PROOF_URL_MAX_LENGTH) return { status: 'UNSUPPORTED_FORMAT' };
  if (unsafeControlCharacter.test(attachment) || /\s/.test(attachment) || attachment.includes('\\') || attachment.includes('%')) return { status: 'UNSUPPORTED_FORMAT' };

  let parsed: URL;
  try {
    parsed = new URL(attachment);
  } catch {
    return { status: 'UNSUPPORTED_FORMAT' };
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.port.length > 0
    || parsed.search.length > 0
    || parsed.hash.length > 0
    || parsed.origin !== config.allowedOrigin
  ) return { status: 'UNSUPPORTED_FORMAT' };

  const storedPrefix = `/${config.bucket}/${config.keyPrefix}`;
  if (!parsed.pathname.startsWith(storedPrefix)) return { status: 'UNSUPPORTED_FORMAT' };
  const filename = parsed.pathname.slice(storedPrefix.length);
  if (!uuidV4ImageFilename.test(filename)) return { status: 'UNSUPPORTED_FORMAT' };
  if (filename.includes('/') || parsed.pathname.includes('//')) return { status: 'UNSUPPORTED_FORMAT' };

  const expectedStoredUrl = `${config.allowedOrigin}${storedPrefix}${filename}`;
  if (attachment !== expectedStoredUrl) return { status: 'UNSUPPORTED_FORMAT' };
  if (!config.enabled) return { status: 'FEATURE_DISABLED' };

  return { status: 'AVAILABLE', filename, key: `${config.keyPrefix}${filename}` };
};

export const trustedPaymentProofUrl = (classification: Extract<PaymentProofClassification, { status: 'AVAILABLE' }>, config: PaymentProofConfig): string => {
  const expectedKey = `${config.keyPrefix}${classification.filename}`;
  if (classification.key !== expectedKey) throw new Error('Payment proof classification key is inconsistent.');
  return `${config.allowedOrigin}/${expectedKey}`;
};

export const paymentProofPath = (requestId: number, paymentId: number): string =>
  `/api/admin/v1/membership-requests/${requestId}/payments/${paymentId}/proof`;
