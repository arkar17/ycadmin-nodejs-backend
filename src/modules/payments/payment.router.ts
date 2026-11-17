import { Router } from 'express';

import { logger } from '../../config/logger.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PaymentController } from './payment.controller.js';
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
};

export const createPaymentRouter = (dependencies: PaymentDependencies): Router => {
  const router = Router();
  const authenticate = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const controller = new PaymentController(new PaymentService(
    dependencies.paymentRepository ?? new PrismaPaymentRepository(),
    dependencies.paymentPushNotificationService ?? new DisabledPaymentPushNotificationService(),
    logger,
  ));

  router.get('/', authenticate, requirePermission('payment:list'), validate(paymentListRequestSchema), controller.list);
  router.get('/:id', authenticate, requirePermission('payment:read'), validate(paymentDetailRequestSchema), controller.detail);
  router.post('/:id/accept', authenticate, requirePermission('payment:update'), validate(paymentAcceptRequestSchema), controller.accept);
  router.post('/:id/decline', authenticate, requirePermission('payment:update'), validate(paymentDeclineRequestSchema), controller.decline);
  return router;
};
