import { isIP } from 'node:net';

export const APPROVED_PAYMENT_PROOF_HOSTNAME = 'yc-fitness-uat.sgp1.digitaloceanspaces.com';
export const APPROVED_PAYMENT_PROOF_BUCKET = 'yc-fitness-uat';
export const APPROVED_PAYMENT_PROOF_KEY_PREFIX = 'payment-attachments/';

export type PaymentProofConfig = {
  enabled: boolean;
  allowedOrigin: string;
  bucket: string;
  keyPrefix: string;
  maxBytes: number;
  maxPixels: number;
  timeoutMs: number;
};

export type PaymentProofEnvironment = {
  PAYMENT_PROOF_ENABLED: boolean;
  PAYMENT_PROOF_ALLOWED_ORIGIN: string;
  PAYMENT_PROOF_BUCKET: string;
  PAYMENT_PROOF_KEY_PREFIX: string;
  PAYMENT_PROOF_MAX_BYTES: number;
  PAYMENT_PROOF_MAX_PIXELS: number;
  PAYMENT_PROOF_TIMEOUT_MS: number;
};

const configurationError = (field: string): never => {
  throw new Error(`Invalid payment proof configuration: ${field}.`);
};

export const paymentProofConfigFromEnvironment = (environment: PaymentProofEnvironment): PaymentProofConfig => {
  let origin: URL;
  try {
    origin = new URL(environment.PAYMENT_PROOF_ALLOWED_ORIGIN);
  } catch {
    return configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must be an absolute URL');
  }

  if (origin.protocol !== 'https:') configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must use HTTPS');
  if (origin.username || origin.password) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must not contain credentials');
  if (origin.port) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must not contain a port');
  if (origin.search || origin.hash) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must not contain a query or fragment');
  if (environment.PAYMENT_PROOF_ALLOWED_ORIGIN !== origin.origin) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must contain only the origin');
  if (isIP(origin.hostname) !== 0 || origin.hostname === 'localhost' || origin.hostname.endsWith('.local')) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN must not target a local or IP host');
  if (origin.hostname !== APPROVED_PAYMENT_PROOF_HOSTNAME) configurationError('PAYMENT_PROOF_ALLOWED_ORIGIN hostname is not approved');
  if (environment.PAYMENT_PROOF_BUCKET !== APPROVED_PAYMENT_PROOF_BUCKET) configurationError('PAYMENT_PROOF_BUCKET is not approved');
  if (environment.PAYMENT_PROOF_KEY_PREFIX !== APPROVED_PAYMENT_PROOF_KEY_PREFIX) configurationError('PAYMENT_PROOF_KEY_PREFIX is not approved');
  if (!Number.isInteger(environment.PAYMENT_PROOF_MAX_BYTES) || environment.PAYMENT_PROOF_MAX_BYTES < 1024 || environment.PAYMENT_PROOF_MAX_BYTES > 25 * 1024 * 1024) configurationError('PAYMENT_PROOF_MAX_BYTES is out of bounds');
  if (!Number.isInteger(environment.PAYMENT_PROOF_MAX_PIXELS) || environment.PAYMENT_PROOF_MAX_PIXELS < 1_000_000 || environment.PAYMENT_PROOF_MAX_PIXELS > 100_000_000) configurationError('PAYMENT_PROOF_MAX_PIXELS is out of bounds');
  if (!Number.isInteger(environment.PAYMENT_PROOF_TIMEOUT_MS) || environment.PAYMENT_PROOF_TIMEOUT_MS < 100 || environment.PAYMENT_PROOF_TIMEOUT_MS > 15_000) configurationError('PAYMENT_PROOF_TIMEOUT_MS is out of bounds');

  return {
    enabled: environment.PAYMENT_PROOF_ENABLED,
    allowedOrigin: origin.origin,
    bucket: environment.PAYMENT_PROOF_BUCKET,
    keyPrefix: environment.PAYMENT_PROOF_KEY_PREFIX,
    maxBytes: environment.PAYMENT_PROOF_MAX_BYTES,
    maxPixels: environment.PAYMENT_PROOF_MAX_PIXELS,
    timeoutMs: environment.PAYMENT_PROOF_TIMEOUT_MS,
  };
};
