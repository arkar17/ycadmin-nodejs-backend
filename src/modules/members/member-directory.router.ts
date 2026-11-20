import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { MemberDirectoryController } from './member-directory.controller.js';
import type { MemberDirectoryRepository } from './member-directory.repository.js';
import { memberDirectoryRequestSchema } from './member-directory.schema.js';
import { MemberDirectoryService } from './member-directory.service.js';
import { MemberManagementController } from './member-management.controller.js';
import type { MemberManagementRepository } from './member-management.repository.js';
import {
  memberDetailRequestSchema,
  memberStatusRequestSchema,
  memberUpdateRequestSchema,
} from './member-management.schema.js';
import { MemberManagementService } from './member-management.service.js';

export type MemberDirectoryDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  memberDirectoryRepository: MemberDirectoryRepository;
  memberManagementRepository?: MemberManagementRepository;
};

/**
 * An explicit factory makes mock-only route mounting possible. It is deliberately
 * not registered in the application router until isolated PostgreSQL tests pass.
 */
export const createMemberDirectoryRouter = (dependencies: MemberDirectoryDependencies): Router => {
  const router = Router();
  const controller = new MemberDirectoryController(new MemberDirectoryService(dependencies.memberDirectoryRepository));
  const managementRepository = dependencies.memberManagementRepository
    ?? dependencies.memberDirectoryRepository as MemberDirectoryRepository & MemberManagementRepository;
  const managementController = new MemberManagementController(new MemberManagementService(managementRepository));
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);

  router.get(
    '/',
    authenticate,
    requirePermission('member:list'),
    validate(memberDirectoryRequestSchema),
    controller.list,
  );

  router.post('/:id/activate', authenticate, requirePermission('member:update'), validate(memberStatusRequestSchema), managementController.activate);
  router.post('/:id/deactivate', authenticate, requirePermission('member:update'), validate(memberStatusRequestSchema), managementController.deactivate);
  router.patch('/:id', authenticate, requirePermission('member:update'), validate(memberUpdateRequestSchema), managementController.update);
  router.get('/:id', authenticate, requirePermission('member:read'), validate(memberDetailRequestSchema), managementController.detail);

  return router;
};
