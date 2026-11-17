import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission, requireSystemAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { logger } from '../../config/logger.js';
import { PrismaRbacMutationRepository, type RbacMutationRepository } from '../admin-rbac/rbac-mutation.repository.js';
import { PinoRbacSecurityAuditSink, type RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { RbacMutationService } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AdminUserController } from './admin-user.controller.js';
import { AdminUserManagementService } from './admin-user-management.service.js';
import type { AdminUserRepository } from './admin-user.repository.js';
import {
  adminUserCreateRequestSchema,
  adminUserDetailRequestSchema,
  adminUserListRequestSchema,
  adminUserReplaceRolesRequestSchema,
  adminUserRoleRequestSchema,
  adminUserStatusRequestSchema,
  adminUserUpdateRequestSchema,
} from './admin-user.schema.js';
import { AdminUserService } from './admin-user.service.js';

export const createAdminUserRouter = (dependencies: {
  adminIdentityRepository: AdminIdentityRepository;
  adminUserRepository: AdminUserRepository;
  rbacMutationRepository?: RbacMutationRepository;
  rbacSecurityAuditSink?: RbacSecurityAuditSink;
}): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const users = new AdminUserService(dependencies.adminUserRepository);
  const mutations = new RbacMutationService(
    dependencies.rbacMutationRepository ?? new PrismaRbacMutationRepository(),
    dependencies.rbacSecurityAuditSink ?? new PinoRbacSecurityAuditSink(logger),
  );
  const controller = new AdminUserController(users, new AdminUserManagementService(users, mutations));
  router.get('/', authenticate, requirePermission('user:list'), validate(adminUserListRequestSchema), controller.list);
  router.post('/', authenticate, requireSystemAdmin, validate(adminUserCreateRequestSchema), controller.create);
  router.post('/:id/activate', authenticate, requireSystemAdmin, validate(adminUserStatusRequestSchema), controller.activate);
  router.post('/:id/deactivate', authenticate, requireSystemAdmin, validate(adminUserStatusRequestSchema), controller.deactivate);
  router.post('/:id/roles/:roleId', authenticate, requireSystemAdmin, validate(adminUserRoleRequestSchema), controller.assignRole);
  router.delete('/:id/roles/:roleId', authenticate, requireSystemAdmin, validate(adminUserRoleRequestSchema), controller.removeRole);
  router.put('/:id/roles', authenticate, requireSystemAdmin, validate(adminUserReplaceRolesRequestSchema), controller.replaceRoles);
  router.patch('/:id', authenticate, requireSystemAdmin, validate(adminUserUpdateRequestSchema), controller.update);
  router.get('/:id', authenticate, requirePermission('user:read'), validate(adminUserDetailRequestSchema), controller.detail);
  return router;
};
