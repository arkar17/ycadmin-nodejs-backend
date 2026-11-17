import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { DashboardController } from './dashboard.controller.js';
import type { DashboardRepository } from './dashboard.repository.js';
import { dashboardOverviewRequestSchema } from './dashboard.schema.js';
import { DashboardService } from './dashboard.service.js';

export type DashboardDependencies = { adminIdentityRepository: AdminIdentityRepository; dashboardRepository: DashboardRepository };

export const createDashboardRouter = (dependencies: DashboardDependencies): Router => {
  const router = Router();
  const controller = new DashboardController(new DashboardService(dependencies.dashboardRepository));
  router.get('/overview', createAuthenticateAdmin(dependencies.adminIdentityRepository), requirePermission('dashboard:read'), validate(dashboardOverviewRequestSchema), controller.overview);
  return router;
};
