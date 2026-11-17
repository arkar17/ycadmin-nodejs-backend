import { inspect } from 'node:util';

import type { env as environment } from './env.js';

export type PushEnvironment = Pick<
  typeof environment,
  | 'PAYMENT_PUSH_ENABLED'
  | 'FIREBASE_CREDENTIAL_SOURCE'
  | 'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64'
  | 'FIREBASE_PROJECT_ID'
  | 'PAYMENT_PUSH_TIMEOUT_MS'
>;

/**
 * Holds decoded service-account material. The fields are private so the
 * credential cannot leak through JSON serialization, pino, or util.inspect;
 * only the Firebase initializer reads it through `toCertificate()`.
 */
export class FirebaseServiceAccountCredential {
  readonly #projectId: string;
  readonly #clientEmail: string;
  readonly #privateKey: string;

  public constructor(projectId: string, clientEmail: string, privateKey: string) {
    this.#projectId = projectId;
    this.#clientEmail = clientEmail;
    this.#privateKey = privateKey;
  }

  public get projectId(): string {
    return this.#projectId;
  }

  public toCertificate(): { projectId: string; clientEmail: string; privateKey: string } {
    return { projectId: this.#projectId, clientEmail: this.#clientEmail, privateKey: this.#privateKey };
  }

  public toJSON(): string {
    return '[REDACTED]';
  }

  public toString(): string {
    return '[REDACTED]';
  }

  public [inspect.custom](): string {
    return 'FirebaseServiceAccountCredential [REDACTED]';
  }
}

export type FirebaseCredentialConfig =
  | { source: 'service_account'; serviceAccount: FirebaseServiceAccountCredential }
  | { source: 'application_default'; projectId: string };

export type EnabledPushConfig = {
  enabled: true;
  timeoutMs: number;
  credential: FirebaseCredentialConfig;
};

export type PushConfig = { enabled: false } | EnabledPushConfig;

/** Startup configuration error whose message is always a fixed, value-free string. */
export class PushConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PushConfigurationError';
  }
}

const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15_000;

const decodeServiceAccount = (encoded: string): FirebaseServiceAccountCredential => {
  // Line-wrapped output from `base64` tools is accepted; anything else must be
  // canonical so malformed secrets fail instead of decoding to garbage.
  const compact = encoded.replace(/\s+/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new PushConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be canonical base64.');
  }
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64') !== compact) {
    throw new PushConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be canonical base64.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    // JSON.parse messages can quote the input, so the original error is dropped.
    throw new PushConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a JSON object.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PushConfigurationError('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a JSON object.');
  }

  const record = parsed as Record<string, unknown>;
  const field = (name: string): string | null => {
    const value = record[name];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const projectId = field('project_id');
  const clientEmail = field('client_email');
  const privateKey = field('private_key');
  if (!projectId || !clientEmail || !privateKey) {
    throw new PushConfigurationError(
      'Firebase service account must contain non-empty project_id, client_email, and private_key fields.',
    );
  }

  return new FirebaseServiceAccountCredential(projectId, clientEmail, privateKey);
};

/**
 * Builds Payment push configuration from validated environment values.
 * Disabled push never inspects Firebase variables. Enabled push with invalid
 * configuration throws PushConfigurationError so startup fails clearly.
 */
export const pushConfigFromEnvironment = (values: PushEnvironment): PushConfig => {
  if (!values.PAYMENT_PUSH_ENABLED) return { enabled: false };

  const timeoutMs = values.PAYMENT_PUSH_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new PushConfigurationError('PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.');
  }

  if (values.FIREBASE_CREDENTIAL_SOURCE === 'application_default') {
    if (values.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      throw new PushConfigurationError(
        'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must not be set when FIREBASE_CREDENTIAL_SOURCE is application_default.',
      );
    }
    if (!values.FIREBASE_PROJECT_ID) {
      throw new PushConfigurationError(
        'FIREBASE_PROJECT_ID is required when FIREBASE_CREDENTIAL_SOURCE is application_default.',
      );
    }
    return { enabled: true, timeoutMs, credential: { source: 'application_default', projectId: values.FIREBASE_PROJECT_ID } };
  }

  if (!values.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    throw new PushConfigurationError(
      'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is required when PAYMENT_PUSH_ENABLED is true and FIREBASE_CREDENTIAL_SOURCE is service_account.',
    );
  }
  const serviceAccount = decodeServiceAccount(values.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64);
  if (values.FIREBASE_PROJECT_ID && values.FIREBASE_PROJECT_ID !== serviceAccount.projectId) {
    throw new PushConfigurationError('FIREBASE_PROJECT_ID does not match the service account project.');
  }

  return { enabled: true, timeoutMs, credential: { source: 'service_account', serviceAccount } };
};
