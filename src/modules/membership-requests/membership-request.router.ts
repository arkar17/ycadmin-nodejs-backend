import { Router } from 'express';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { env } from '../../config/env.js';
import { paymentProofConfigFromEnvironment } from '../../config/payment-proof.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { MembershipRequestController } from './membership-request.controller.js';
import type { MembershipRequestRepository } from './membership-request.repository.js';
import { membershipRequestApproveRequestSchema, membershipRequestDetailRequestSchema, membershipRequestListRequestSchema, membershipRequestProofRequestSchema, membershipRequestRejectRequestSchema } from './membership-request.schema.js';
import { MembershipRequestService } from './membership-request.service.js';
import { HttpPaymentProofFetcher } from './payment-proof.fetcher.js';
import { SharpPaymentProofImageNormalizer } from './payment-proof.image.js';
import { MembershipPaymentProofService } from './payment-proof.service.js';

export type MembershipRequestDependencies = { adminIdentityRepository: AdminIdentityRepository; membershipRequestRepository: MembershipRequestRepository; paymentProofService?: MembershipPaymentProofService };
export const createMembershipRequestRouter = (dependencies: MembershipRequestDependencies): Router => {
  const router = Router();
  const config = paymentProofConfigFromEnvironment(env);
  const paymentProofService = dependencies.paymentProofService ?? new MembershipPaymentProofService(
    dependencies.membershipRequestRepository,
    config,
    new HttpPaymentProofFetcher(config),
    new SharpPaymentProofImageNormalizer(config),
  );
  const controller = new MembershipRequestController(new MembershipRequestService(dependencies.membershipRequestRepository, paymentProofService));
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  router.get('/', authenticateAdmin, requirePermission('member-request:list'), validate(membershipRequestListRequestSchema), controller.list);
  router.get('/:requestId/payments/:paymentId/proof', authenticateAdmin, requirePermission('member-request:read'), validate(membershipRequestProofRequestSchema), controller.proof);
  router.get('/:id', authenticateAdmin, requirePermission('member-request:read'), validate(membershipRequestDetailRequestSchema), controller.detail);
  router.post('/:id/approve', authenticateAdmin, requirePermission('member-request:update'), validate(membershipRequestApproveRequestSchema), controller.approve);
  router.post('/:id/reject', authenticateAdmin, requirePermission('member-request:update'), validate(membershipRequestRejectRequestSchema), controller.reject);
  return router;
};
