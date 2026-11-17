import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { MemberTypeController } from './member-type.controller.js';
import type { MemberTypeRepository } from './member-type.repository.js';
import { memberTypeListRequestSchema } from './member-type.schema.js';
import { MemberTypeService } from './member-type.service.js';

export type MemberTypeDependencies = { adminIdentityRepository: AdminIdentityRepository; memberTypeRepository: MemberTypeRepository };

export const createMemberTypeRouter = (dependencies: MemberTypeDependencies): Router => {
  const router = Router();
  const controller = new MemberTypeController(new MemberTypeService(dependencies.memberTypeRepository));
  router.get('/', createAuthenticateAdmin(dependencies.adminIdentityRepository), requirePermission('member-type:list'), validate(memberTypeListRequestSchema), controller.list);
  return router;
};
