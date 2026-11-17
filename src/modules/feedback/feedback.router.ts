import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { FeedbackController } from './feedback.controller.js';
import type { FeedbackRepository } from './feedback.repository.js';
import { feedbackDetailRequestSchema, feedbackListRequestSchema } from './feedback.schema.js';
import { FeedbackService } from './feedback.service.js';

export type FeedbackDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  feedbackRepository: FeedbackRepository;
};

export const createFeedbackRouter = (dependencies: FeedbackDependencies): Router => {
  const router = Router();
  const controller = new FeedbackController(new FeedbackService(dependencies.feedbackRepository));
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);

  router.get('/', authenticateAdmin, requirePermission('feedback:list'), validate(feedbackListRequestSchema), controller.list);
  router.get(
    '/:id',
    authenticateAdmin,
    requirePermission('feedback:read'),
    validate(feedbackDetailRequestSchema),
    controller.detail,
  );

  return router;
};
