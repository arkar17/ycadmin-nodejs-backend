import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AdminRoleController } from './admin-role.controller.js';
import type { AdminRoleRepository } from './admin-role.repository.js';
import { adminRoleDetailRequestSchema, adminRoleListRequestSchema } from './admin-role.schema.js';
import { AdminRoleService } from './admin-role.service.js';

export const createAdminRoleRouter = (dependencies: {
  adminIdentityRepository: AdminIdentityRepository;
  adminRoleRepository: AdminRoleRepository;
}): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const controller = new AdminRoleController(new AdminRoleService(dependencies.adminRoleRepository));
  router.get('/', authenticate, requirePermission('role:list'), validate(adminRoleListRequestSchema), controller.list);
  router.get('/:id', authenticate, requirePermission('role:read'), validate(adminRoleDetailRequestSchema), controller.detail);
  return router;
};
