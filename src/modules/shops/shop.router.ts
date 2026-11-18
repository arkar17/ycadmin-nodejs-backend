import { Router } from 'express';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { ShopController } from './shop.controller.js';
import type { ShopRepository } from './shop.repository.js';
import { shopDetailRequestSchema, shopListRequestSchema } from './shop.schema.js';
import { ShopService } from './shop.service.js';
export const createShopRouter = (dependencies: { adminIdentityRepository: AdminIdentityRepository; shopRepository: ShopRepository }): Router => {
  const router = Router(); const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository); const controller = new ShopController(new ShopService(dependencies.shopRepository));
  router.get('/', authenticate, requirePermission('shop:list'), validate(shopListRequestSchema), controller.list);
  router.get('/:id', authenticate, requirePermission('shop:read'), validate(shopDetailRequestSchema), controller.detail);
  return router;
};
