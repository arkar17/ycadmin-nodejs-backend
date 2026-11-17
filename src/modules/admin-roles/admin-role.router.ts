import { Router } from 'express';

import { logger } from '../../config/logger.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission, requireSystemAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { PrismaRbacMutationRepository, type RbacMutationRepository } from '../admin-rbac/rbac-mutation.repository.js';
import { PinoRbacSecurityAuditSink, type RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { RbacMutationService } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AdminRoleController } from './admin-role.controller.js';
import { AdminRoleManagementService } from './admin-role-management.service.js';
import type { AdminRoleRepository } from './admin-role.repository.js';
import {
  adminRoleCreateRequestSchema,
  adminRoleDetailRequestSchema,
  adminRoleListRequestSchema,
  adminRolePermissionRequestSchema,
  adminRoleReplacePermissionsRequestSchema,
  adminRoleStatusRequestSchema,
  adminRoleUpdateRequestSchema,
} from './admin-role.schema.js';
import { AdminRoleService } from './admin-role.service.js';

export const createAdminRoleRouter = (dependencies: {
  adminIdentityRepository: AdminIdentityRepository;
  adminRoleRepository: AdminRoleRepository;
  rbacMutationRepository?: RbacMutationRepository;
  rbacSecurityAuditSink?: RbacSecurityAuditSink;
}): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const roles = new AdminRoleService(dependencies.adminRoleRepository);
  const mutations = new RbacMutationService(
    dependencies.rbacMutationRepository ?? new PrismaRbacMutationRepository(),
    dependencies.rbacSecurityAuditSink ?? new PinoRbacSecurityAuditSink(logger),
  );
  const controller = new AdminRoleController(roles, new AdminRoleManagementService(roles, mutations));
  router.get('/', authenticate, requirePermission('role:list'), validate(adminRoleListRequestSchema), controller.list);
  router.post('/', authenticate, requireSystemAdmin, validate(adminRoleCreateRequestSchema), controller.create);
  router.post('/:id/activate', authenticate, requireSystemAdmin, validate(adminRoleStatusRequestSchema), controller.activate);
  router.post('/:id/deactivate', authenticate, requireSystemAdmin, validate(adminRoleStatusRequestSchema), controller.deactivate);
  router.post('/:id/permissions/:permissionId', authenticate, requireSystemAdmin, validate(adminRolePermissionRequestSchema), controller.assignPermission);
  router.delete('/:id/permissions/:permissionId', authenticate, requireSystemAdmin, validate(adminRolePermissionRequestSchema), controller.removePermission);
  router.put('/:id/permissions', authenticate, requireSystemAdmin, validate(adminRoleReplacePermissionsRequestSchema), controller.replacePermissions);
  router.patch('/:id', authenticate, requireSystemAdmin, validate(adminRoleUpdateRequestSchema), controller.update);
  router.get('/:id', authenticate, requirePermission('role:read'), validate(adminRoleDetailRequestSchema), controller.detail);
  return router;
};
