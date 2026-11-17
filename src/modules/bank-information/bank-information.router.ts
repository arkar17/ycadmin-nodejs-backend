import { Router } from 'express';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { BankInformationController } from './bank-information.controller.js';
import type { BankInformationRepository } from './bank-information.repository.js';
import { bankInformationCreateRequestSchema, bankInformationDeleteRequestSchema, bankInformationDetailRequestSchema, bankInformationListRequestSchema, bankInformationUpdateRequestSchema } from './bank-information.schema.js';
import { BankInformationService } from './bank-information.service.js';

export type BankInformationDependencies = { adminIdentityRepository: AdminIdentityRepository; bankInformationRepository: BankInformationRepository };

export const createBankInformationRouter = (dependencies: BankInformationDependencies): Router => {
  const router = Router();
  const controller = new BankInformationController(new BankInformationService(dependencies.bankInformationRepository));
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  router.get('/', authenticateAdmin, requirePermission('bank-information:list'), validate(bankInformationListRequestSchema), controller.list);
  router.get('/:id', authenticateAdmin, requirePermission('bank-information:read'), validate(bankInformationDetailRequestSchema), controller.detail);
  router.post('/', authenticateAdmin, requirePermission('bank-information:create'), validate(bankInformationCreateRequestSchema), controller.create);
  router.patch('/:id', authenticateAdmin, requirePermission('bank-information:update'), validate(bankInformationUpdateRequestSchema), controller.update);
  router.delete('/:id', authenticateAdmin, requirePermission('bank-information:delete'), validate(bankInformationDeleteRequestSchema), controller.remove);
  return router;
};
