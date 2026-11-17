import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import type { AdminIdentityRepository } from './admin-identity.repository.js';
import { CurrentAdminController } from './current-admin.controller.js';
import type { CurrentAdminRepository } from './current-admin.repository.js';
import { CurrentAdminService } from './current-admin.service.js';

export type CurrentAdminDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  currentAdminRepository: CurrentAdminRepository;
};

export const createCurrentAdminRouter = (dependencies: CurrentAdminDependencies): Router => {
  const router = Router();
  const controller = new CurrentAdminController(new CurrentAdminService(dependencies.currentAdminRepository));
  router.get('/me', createAuthenticateAdmin(dependencies.adminIdentityRepository), controller.me);
  return router;
};
