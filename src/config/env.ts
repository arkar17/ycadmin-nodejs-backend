import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';

loadEnvironment({ quiet: true });

const optionalSecret = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN must be a positive duration such as 15m, 1h, or 30d.').default('30d'),
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
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const problems = parsedEnvironment.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration: ${problems}`);
}

export const env = parsedEnvironment.data;
