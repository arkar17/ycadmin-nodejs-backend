import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { PlanDurationController } from './plan-duration.controller.js';
import type { PlanDurationRepository } from './plan-duration.repository.js';
import {
  planDurationCreateRequestSchema,
  planDurationDeleteRequestSchema,
  planDurationListRequestSchema,
  planDurationUpdateRequestSchema,
} from './plan-duration.schema.js';
import { PlanDurationService } from './plan-duration.service.js';

export type PlanDurationDependencies = { adminIdentityRepository: AdminIdentityRepository; planDurationRepository: PlanDurationRepository };

export const createPlanDurationRouter = (dependencies: PlanDurationDependencies): Router => {
  const router = Router();
  const controller = new PlanDurationController(new PlanDurationService(dependencies.planDurationRepository));
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);

  router.get('/', authenticateAdmin, requirePermission('plan-duration:list'), validate(planDurationListRequestSchema), controller.list);
  router.post('/', authenticateAdmin, requirePermission('plan-duration:create'), validate(planDurationCreateRequestSchema), controller.create);
  router.patch('/:id', authenticateAdmin, requirePermission('plan-duration:update'), validate(planDurationUpdateRequestSchema), controller.update);
  router.delete('/:id', authenticateAdmin, requirePermission('plan-duration:delete'), validate(planDurationDeleteRequestSchema), controller.remove);
  return router;
};
