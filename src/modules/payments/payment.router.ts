import { Router } from 'express';

import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { paymentProofConfigFromEnvironment } from '../../config/payment-proof.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PaymentController } from './payment.controller.js';
import { HttpPaymentProofFetcher } from '../payment-proof/payment-proof.fetcher.js';
import { SharpPaymentProofImageNormalizer } from '../payment-proof/payment-proof.image.js';
import { PaymentProofService } from './payment-proof.service.js';
import { DisabledPaymentPushNotificationService, type PaymentPushNotificationService } from './payment-push.service.js';
import { PrismaPaymentRepository, type PaymentRepository } from './payment.repository.js';
import {
  paymentAcceptRequestSchema,
  paymentDeclineRequestSchema,
  paymentDetailRequestSchema,
  paymentListRequestSchema,
} from './payment.schema.js';
import { PaymentService } from './payment.service.js';

export type PaymentDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  paymentRepository?: PaymentRepository;
  paymentPushNotificationService?: PaymentPushNotificationService;
  paymentProofService?: PaymentProofService;
};

export const createPaymentRouter = (dependencies: PaymentDependencies): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const paymentRepository = dependencies.paymentRepository ?? new PrismaPaymentRepository();
  const proofConfig = paymentProofConfigFromEnvironment(env);
  const paymentProofService = dependencies.paymentProofService ?? new PaymentProofService(
    paymentRepository,
    proofConfig,
    new HttpPaymentProofFetcher(proofConfig),
    new SharpPaymentProofImageNormalizer(proofConfig),
  );
  const controller = new PaymentController(new PaymentService(
    paymentRepository,
    dependencies.paymentPushNotificationService ?? new DisabledPaymentPushNotificationService(),
    logger,
    paymentProofService,
  ));

  router.get('/', authenticate, requirePermission('payment:list'), validate(paymentListRequestSchema), controller.list);
  router.get('/:id/proof', authenticate, requirePermission('payment:read'), validate(paymentDetailRequestSchema), controller.proof);
  router.get('/:id', authenticate, requirePermission('payment:read'), validate(paymentDetailRequestSchema), controller.detail);
  router.post('/:id/accept', authenticate, requirePermission('payment:update'), validate(paymentAcceptRequestSchema), controller.accept);
  router.post('/:id/decline', authenticate, requirePermission('payment:update'), validate(paymentDeclineRequestSchema), controller.decline);
  return router;
};
