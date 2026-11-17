import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ShopPlanLevelController } from './shop-plan-level.controller.js';
import type { ShopPlanLevelRepository } from './shop-plan-level.repository.js';
import { shopPlanLevelDetailRequestSchema, shopPlanLevelListRequestSchema } from './shop-plan-level.schema.js';
import { ShopPlanLevelService } from './shop-plan-level.service.js';

export type ShopPlanLevelDependencies = { adminIdentityRepository: AdminIdentityRepository; shopPlanLevelRepository: ShopPlanLevelRepository };

export const createShopPlanLevelRouter = (dependencies: ShopPlanLevelDependencies): Router => {
  const router = Router();
  const controller = new ShopPlanLevelController(new ShopPlanLevelService(dependencies.shopPlanLevelRepository));
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  router.get('/', authenticateAdmin, requirePermission('shop-level:list'), validate(shopPlanLevelListRequestSchema), controller.list);
  router.get('/:id', authenticateAdmin, requirePermission('shop-level:read'), validate(shopPlanLevelDetailRequestSchema), controller.detail);
  return router;
};
