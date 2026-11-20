import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';

import { parseTrustProxy } from './trust-proxy.js';

loadEnvironment({ quiet: true });

const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const booleanString = (defaultValue: 'true' | 'false') => z.preprocess(
  (value) => value === '' ? undefined : value,
  z.enum(['true', 'false']).default(defaultValue),
).transform((value) => value === 'true');

const optionalOrigin = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().refine((value) => new URL(value).origin === value, 'must be an exact origin without a path, query, or fragment').optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must be a positive duration such as 15m, 1h, or 30d.').default('30d'),
  ADMIN_BROWSER_AUTH_ENABLED: booleanString('false'),
  ADMIN_AUTH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/, 'ADMIN_AUTH_COOKIE_NAME contains invalid characters.').default('yc_admin_session'),
  ADMIN_AUTH_COOKIE_SECURE: booleanString('true'),
  ADMIN_AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict']).default('lax'),
  ADMIN_AUTH_COOKIE_MAX_AGE_SECONDS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(900).max(43_200).default(28_800),
  ),
  ADMIN_AUTH_ALLOWED_ORIGIN: optionalOrigin,
  // Express `trust proxy`. Default false: only the TCP peer is trusted. See src/config/trust-proxy.ts.
  ADMIN_TRUST_PROXY: z.string().optional().transform((value, context) => {
    try {
      return parseTrustProxy(value);
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'is invalid.' });
      return z.NEVER;
    }
  }),
  DATABASE_URL: z.string().url().optional(),
  // These are deliberately optional so health checks and APIs unrelated to QR
  // management can start without decryption capability. The QR route fails
  // closed until both are supplied by an approved secret provider.
  ATTENDANCE_QR_ENCRYPTION_KEY: optionalSecret,
  ATTENDANCE_QR_HMAC_KEY: optionalSecret,
  // Payment push (FCM) is opt-in. Cross-field requirements are validated by
  // src/config/push.ts so error messages can stay fixed and value-free.
  PAYMENT_PUSH_ENABLED: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['true', 'false'], { message: 'PAYMENT_PUSH_ENABLED must be true or false.' }).default('false'),
  ).transform((value) => value === 'true'),
  FIREBASE_CREDENTIAL_SOURCE: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['service_account', 'application_default'], {
      message: 'FIREBASE_CREDENTIAL_SOURCE must be service_account or application_default.',
    }).default('service_account'),
  ),
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: optionalSecret,
  FIREBASE_PROJECT_ID: optionalSecret,
  PAYMENT_PUSH_TIMEOUT_MS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number({ message: 'PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.' })
      .int('PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.')
      .min(500, 'PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.')
      .max(15000, 'PAYMENT_PUSH_TIMEOUT_MS must be an integer between 500 and 15000.')
      .default(5000),
  ),
  PAYMENT_PROOF_ENABLED: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['true', 'false'], { message: 'PAYMENT_PROOF_ENABLED must be true or false.' }).default('false'),
  ).transform((value) => value === 'true'),
  PAYMENT_PROOF_ALLOWED_ORIGIN: z.string().default('https://yc-fitness-uat.sgp1.digitaloceanspaces.com'),
  PAYMENT_PROOF_BUCKET: z.string().default('yc-fitness-uat'),
  PAYMENT_PROOF_KEY_PREFIX: z.string().default('payment-attachments/'),
  PAYMENT_PROOF_MAX_BYTES: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(1024).max(25 * 1024 * 1024).default(5 * 1024 * 1024),
  ),
  PAYMENT_PROOF_MAX_PIXELS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(1_000_000).max(100_000_000).default(40_000_000),
  ),
  PAYMENT_PROOF_TIMEOUT_MS: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().min(100).max(15_000).default(5000),
  ),
}).superRefine((value, context) => {
  if (!value.ADMIN_BROWSER_AUTH_ENABLED) return;
  if (!value.ADMIN_AUTH_ALLOWED_ORIGIN) {
    context.addIssue({ code: 'custom', path: ['ADMIN_AUTH_ALLOWED_ORIGIN'], message: 'is required when browser authentication is enabled.' });
  } else if (value.NODE_ENV !== 'development' && !value.ADMIN_AUTH_ALLOWED_ORIGIN.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['ADMIN_AUTH_ALLOWED_ORIGIN'], message: 'must use HTTPS outside local development.' });
  }
  if (value.NODE_ENV !== 'development' && !value.ADMIN_AUTH_COOKIE_SECURE) {
    context.addIssue({ code: 'custom', path: ['ADMIN_AUTH_COOKIE_SECURE'], message: 'must be true outside local development.' });
  }
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const problems = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration: ${problems}`);
}

export const env = parsedEnvironment.data;
