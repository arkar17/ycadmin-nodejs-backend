import pino from 'pino';

import { env } from './env.js';

export const loggerRedaction = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.passwordConfirm',
    'req.body.token',
    'req.body.refreshToken',
    // Defence in depth for push delivery: FCM tokens and Firebase credentials
    // are never logged intentionally, but are censored if they ever are.
    'token',
    '*.token',
    'pushTarget.token',
    '*.pushTarget.token',
    'private_key',
    '*.private_key',
    'privateKey',
    '*.privateKey',
    'credential',
    '*.credential',
    'serviceAccount',
    '*.serviceAccount',
  ],
  censor: '[REDACTED]',
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: loggerRedaction,
});
