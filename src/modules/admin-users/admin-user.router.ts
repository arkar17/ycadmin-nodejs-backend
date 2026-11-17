import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AdminUserController } from './admin-user.controller.js';
import type { AdminUserRepository } from './admin-user.repository.js';
import { adminUserDetailRequestSchema, adminUserListRequestSchema } from './admin-user.schema.js';
import { AdminUserService } from './admin-user.service.js';

export const createAdminUserRouter = (dependencies: {
  adminIdentityRepository: AdminIdentityRepository;
  adminUserRepository: AdminUserRepository;
}): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const controller = new AdminUserController(new AdminUserService(dependencies.adminUserRepository));
  router.get('/', authenticate, requirePermission('user:list'), validate(adminUserListRequestSchema), controller.list);
  router.get('/:id', authenticate, requirePermission('user:read'), validate(adminUserDetailRequestSchema), controller.detail);
  return router;
};
