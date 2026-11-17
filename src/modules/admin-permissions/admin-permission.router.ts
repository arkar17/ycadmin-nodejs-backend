import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AdminPermissionController } from './admin-permission.controller.js';
import type { AdminPermissionRepository } from './admin-permission.repository.js';
import {
  adminPermissionDetailRequestSchema,
  adminPermissionListRequestSchema,
} from './admin-permission.schema.js';
import { AdminPermissionService } from './admin-permission.service.js';

export const createAdminPermissionRouter = (dependencies: {
  adminIdentityRepository: AdminIdentityRepository;
  adminPermissionRepository: AdminPermissionRepository;
}): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const controller = new AdminPermissionController(new AdminPermissionService(dependencies.adminPermissionRepository));
  router.get(
    '/',
    authenticate,
    requirePermission('permission:list'),
    validate(adminPermissionListRequestSchema),
    controller.list,
  );
  router.get(
    '/:id',
    authenticate,
    requirePermission('permission:read'),
    validate(adminPermissionDetailRequestSchema),
    controller.detail,
  );
  return router;
};
