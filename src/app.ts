import express from 'express';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import type { TrustProxySetting } from './config/trust-proxy.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';

export type AppOptions = { trustProxy?: TrustProxySetting };

export const createApp = (options: AppOptions = {}): express.Express => {
  const app = express();

  app.disable('x-powered-by');
  // Only an explicitly validated setting is used; the default (false) trusts no forwarded headers.
  const trustProxy = options.trustProxy ?? env.ADMIN_TRUST_PROXY;
  app.set('trust proxy', Array.isArray(trustProxy) ? [...trustProxy] : trustProxy);
  app.use(
    pinoHttp({
      logger,
      genReqId: (request: IncomingMessage) => {
        const requestId = request.headers['x-request-id'];
        return typeof requestId === 'string' ? requestId : crypto.randomUUID();
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
