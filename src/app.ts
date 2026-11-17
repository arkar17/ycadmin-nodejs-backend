import express from 'express';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';

import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';

export const createApp = (): express.Express => {
  const app = express();

  app.disable('x-powered-by');
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
