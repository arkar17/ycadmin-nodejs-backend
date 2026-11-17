import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { MemberDirectoryController } from './member-directory.controller.js';
import type { MemberDirectoryRepository } from './member-directory.repository.js';
import { memberDirectoryRequestSchema } from './member-directory.schema.js';
import { MemberDirectoryService } from './member-directory.service.js';

export type MemberDirectoryDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  memberDirectoryRepository: MemberDirectoryRepository;
};

/**
 * An explicit factory makes mock-only route mounting possible. It is deliberately
 * not registered in the application router until isolated PostgreSQL tests pass.
 */
export const createMemberDirectoryRouter = (dependencies: MemberDirectoryDependencies): Router => {
  const router = Router();
  const controller = new MemberDirectoryController(new MemberDirectoryService(dependencies.memberDirectoryRepository));

  router.get(
    '/',
    createAuthenticateAdmin(dependencies.adminIdentityRepository),
    requirePermission('member:list'),
    validate(memberDirectoryRequestSchema),
    controller.list,
  );

  return router;
};
