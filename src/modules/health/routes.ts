import { Router } from 'express';

import { sendData } from '../../shared/api-response.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => sendData(response, { status: 'ok' }));
