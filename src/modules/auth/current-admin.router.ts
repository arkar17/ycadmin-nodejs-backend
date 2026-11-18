import { Router } from 'express';

import { adminBrowserAuthConfig, type AdminBrowserAuthConfig } from '../../config/admin-browser-auth.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import type { AdminIdentityRepository } from './admin-identity.repository.js';
import { CurrentAdminController } from './current-admin.controller.js';
import type { CurrentAdminRepository } from './current-admin.repository.js';
import { CurrentAdminService } from './current-admin.service.js';

export type CurrentAdminDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  currentAdminRepository: CurrentAdminRepository;
  browserAuth?: AdminBrowserAuthConfig;
};

export const createCurrentAdminRouter = (dependencies: CurrentAdminDependencies): Router => {
  const router = Router();
  const controller = new CurrentAdminController(new CurrentAdminService(dependencies.currentAdminRepository));
  router.get(
    '/me',
    createAuthenticateAdmin(dependencies.adminIdentityRepository, dependencies.browserAuth ?? adminBrowserAuthConfig),
    controller.me,
  );
  return router;
};
