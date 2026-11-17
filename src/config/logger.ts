import pino from 'pino';

import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.passwordConfirm',
      'req.body.token',
      'req.body.refreshToken',
    ],
    censor: '[REDACTED]',
  },
});
