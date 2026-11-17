import { Router } from 'express';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { MembershipRequestController } from './membership-request.controller.js';
import type { MembershipRequestRepository } from './membership-request.repository.js';
import { membershipRequestDetailRequestSchema, membershipRequestListRequestSchema } from './membership-request.schema.js';
import { MembershipRequestService } from './membership-request.service.js';

export type MembershipRequestDependencies = { adminIdentityRepository: AdminIdentityRepository; membershipRequestRepository: MembershipRequestRepository };
export const createMembershipRequestRouter = (dependencies: MembershipRequestDependencies): Router => {
  const router = Router(); const controller = new MembershipRequestController(new MembershipRequestService(dependencies.membershipRequestRepository)); const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  router.get('/', authenticateAdmin, requirePermission('member-request:list'), validate(membershipRequestListRequestSchema), controller.list);
  router.get('/:id', authenticateAdmin, requirePermission('member-request:read'), validate(membershipRequestDetailRequestSchema), controller.detail);
  return router;
};
