import { Router } from 'express';

import { adminV1Router } from './admin-v1.js';

export const apiRouter = Router();
apiRouter.use('/admin/v1', adminV1Router);
