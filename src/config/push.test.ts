import { inspect } from 'node:util';

import { pushConfigFromEnvironment, PushConfigurationError, type PushEnvironment } from './push.js';

const PRIVATE_KEY_MARKER = 'FAKE-PRIVATE-KEY-MARKER-do-not-leak';
const fakeServiceAccount = (overrides: Record<string, unknown> = {}) => ({
  type: 'service_account',
  project_id: 'fake-project',
  client_email: 'fake-sender@fake-project.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${PRIVATE_KEY_MARKER}\n-----END PRIVATE KEY-----\n`,
  ...overrides,
});
const encode = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');

const environment = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  PAYMENT_PUSH_ENABLED: true,
  FIREBASE_CREDENTIAL_SOURCE: 'service_account',
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: encode(fakeServiceAccount()),
  FIREBASE_PROJECT_ID: undefined,
  PAYMENT_PUSH_TIMEOUT_MS: 5000,
  ...overrides,
});

const captureError = (values: PushEnvironment): PushConfigurationError => {
  try {
    pushConfigFromEnvironment(values);
  } catch (error) {
    expect(error).toBeInstanceOf(PushConfigurationError);
    return error as PushConfigurationError;
  }
  throw new Error('expected pushConfigFromEnvironment to throw');
};

const serialized = (error: Error) => [error.message, error.stack ?? '', inspect(error), JSON.stringify(error)].join('\n');

describe('pushConfigFromEnvironment', () => {
  it('returns disabled config without inspecting Firebase variables', () => {
    expect(pushConfigFromEnvironment(environment({
      PAYMENT_PUSH_ENABLED: false,
      FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: 'not base64 at all !!!',
      PAYMENT_PUSH_TIMEOUT_MS: 1,
    }))).toEqual({ enabled: false });
  });

  it('requires a service account credential when enabled in service_account mode', () => {
    const error = captureError(environment({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: undefined }));
    expect(error.message).toMatch(/FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is required/);
  });

  it('rejects invalid base64 without echoing the input', () => {
    const input = `###${PRIVATE_KEY_MARKER}###`;
    const error = captureError(environment({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: input }));
    expect(error.message).toBe('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be canonical base64.');
    expect(serialized(error)).not.toContain(PRIVATE_KEY_MARKER);
    expect(serialized(error)).not.toContain(input);
  });

  it('rejects invalid JSON without leaking JSON.parse text or input', () => {
    const raw = `{"private_key": "${PRIVATE_KEY_MARKER}", broken`;
    const error = captureError(environment({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: encode(raw) }));
    expect(error.message).toBe('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a JSON object.');
    expect(serialized(error)).not.toContain(PRIVATE_KEY_MARKER);
    expect(serialized(error)).not.toMatch(/Unexpected|position|JSON at/);
    expect(error).not.toHaveProperty('cause');
  });

  it('rejects non-object JSON', () => {
    expect(captureError(environment({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: encode('[1,2]') })).message)
      .toBe('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must decode to a JSON object.');
  });

  it.each(['project_id', 'client_email', 'private_key'])('rejects a service account missing %s without leaking values', (field) => {
    const error = captureError(environment({
      FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: encode(fakeServiceAccount({ [field]: undefined })),
    }));
    expect(error.message).toMatch(/must contain non-empty project_id, client_email, and private_key/);
    expect(serialized(error)).not.toContain(PRIVATE_KEY_MARKER);
    expect(serialized(error)).not.toContain('fake-sender@');
  });

  it('accepts line-wrapped base64 and returns a credential that cannot be serialized', () => {
    const wrapped = encode(fakeServiceAccount()).replace(/(.{76})/g, '$1\n');
    const config = pushConfigFromEnvironment(environment({ FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: wrapped }));
    expect(config).toMatchObject({ enabled: true, timeoutMs: 5000, credential: { source: 'service_account' } });
    if (!config.enabled || config.credential.source !== 'service_account') throw new Error('unexpected config');
    expect(config.credential.serviceAccount.toCertificate()).toEqual({
      projectId: 'fake-project',
      clientEmail: 'fake-sender@fake-project.iam.gserviceaccount.com',
      privateKey: expect.stringContaining(PRIVATE_KEY_MARKER),
    });
    expect(JSON.stringify(config)).not.toContain(PRIVATE_KEY_MARKER);
    expect(inspect(config, { depth: 10 })).not.toContain(PRIVATE_KEY_MARKER);
    expect(String(config.credential.serviceAccount)).toBe('[REDACTED]');
  });

  it('validates FIREBASE_PROJECT_ID against the service account without exposing either value', () => {
    expect(pushConfigFromEnvironment(environment({ FIREBASE_PROJECT_ID: 'fake-project' })).enabled).toBe(true);
    const error = captureError(environment({ FIREBASE_PROJECT_ID: 'other-project' }));
    expect(error.message).toBe('FIREBASE_PROJECT_ID does not match the service account project.');
    expect(serialized(error)).not.toMatch(/fake-project|other-project/);
  });

  it('validates application_default mode configuration', () => {
    expect(captureError(environment({
      FIREBASE_CREDENTIAL_SOURCE: 'application_default',
      FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: undefined,
    })).message).toMatch(/FIREBASE_PROJECT_ID is required/);
    expect(captureError(environment({
      FIREBASE_CREDENTIAL_SOURCE: 'application_default',
      FIREBASE_PROJECT_ID: 'fake-project',
    })).message).toMatch(/must not be set when FIREBASE_CREDENTIAL_SOURCE is application_default/);
    expect(pushConfigFromEnvironment(environment({
      FIREBASE_CREDENTIAL_SOURCE: 'application_default',
      FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: undefined,
      FIREBASE_PROJECT_ID: 'fake-project',
      PAYMENT_PUSH_TIMEOUT_MS: 2500,
    }))).toEqual({
      enabled: true,
      timeoutMs: 2500,
      credential: { source: 'application_default', projectId: 'fake-project' },
    });
  });

  it.each([499, 15001, 1.5])('rejects timeout %s outside 500-15000 ms', (timeout) => {
    expect(captureError(environment({ PAYMENT_PUSH_TIMEOUT_MS: timeout })).message)
      .toBe('PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.');
  });
});
