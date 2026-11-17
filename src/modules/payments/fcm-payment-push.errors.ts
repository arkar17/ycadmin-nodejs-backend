/**
 * Application-owned FCM delivery errors. Each carries a fixed message and, at
 * most, a safe provider code. The provider error, its message, the token, the
 * response, and credentials are never retained (no `cause`).
 */
export abstract class FcmDeliveryError extends Error {
  public readonly providerCode: string | undefined;

  protected constructor(name: string, message: string, providerCode?: string) {
    super(message);
    this.name = name;
    this.providerCode = providerCode;
  }
}

export class FcmTokenInvalidError extends FcmDeliveryError {
  public constructor(providerCode?: string) {
    super('FcmTokenInvalidError', 'FCM rejected the registration token as invalid or unregistered.', providerCode);
  }
}

export class FcmCredentialError extends FcmDeliveryError {
  public constructor(providerCode?: string) {
    super('FcmCredentialError', 'FCM rejected the configured Firebase credentials.', providerCode);
  }
}

export class FcmProviderRejectedError extends FcmDeliveryError {
  public constructor(providerCode?: string) {
    super('FcmProviderRejectedError', 'FCM permanently rejected the message.', providerCode);
  }
}

export class FcmTransientError extends FcmDeliveryError {
  public constructor(providerCode?: string) {
    super('FcmTransientError', 'FCM delivery failed with a transient provider or network error.', providerCode);
  }
}

export class FcmTimeoutError extends FcmDeliveryError {
  public constructor() {
    super('FcmTimeoutError', 'FCM delivery exceeded the configured timeout.');
  }
}

export class FcmUnknownError extends FcmDeliveryError {
  public constructor(providerCode?: string) {
    super('FcmUnknownError', 'FCM delivery failed for an unclassified reason.', providerCode);
  }
}

const TOKEN_INVALID = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const CREDENTIAL = new Set([
  'app/invalid-credential',
  'messaging/invalid-credential',
  'messaging/mismatched-credential',
  'messaging/third-party-auth-error',
  'messaging/authentication-error',
  'messaging/insufficient-permission',
]);

const PROVIDER_REJECTED = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-recipient',
  'messaging/invalid-options',
  'messaging/invalid-package-name',
]);

const TRANSIENT = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unavailable',
  'messaging/quota-exceeded',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
  'messaging/topics-message-rate-exceeded',
  'app/network-error',
  'app/network-timeout',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
]);

// Only codes with this shape are retained; anything else could carry arbitrary text.
const SAFE_CODE = /^(?:(?:app|messaging)\/[a-z0-9-]{1,64}|E[A-Z0-9_]{1,32})$/;

const safeCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined;
};

/** Maps any thrown value from the Firebase SDK into a sanitized FcmDeliveryError. */
export const toFcmDeliveryError = (error: unknown): FcmDeliveryError => {
  if (error instanceof FcmDeliveryError) return error;
  const code = safeCode(error);
  if (!code) return new FcmUnknownError();
  if (TOKEN_INVALID.has(code)) return new FcmTokenInvalidError(code);
  if (CREDENTIAL.has(code)) return new FcmCredentialError(code);
  if (PROVIDER_REJECTED.has(code)) return new FcmProviderRejectedError(code);
  if (TRANSIENT.has(code)) return new FcmTransientError(code);
  return new FcmUnknownError(code);
};
