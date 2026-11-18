import { Router } from 'express';

import { adminBrowserAuthConfig, type AdminBrowserAuthConfig } from '../../config/admin-browser-auth.js';
import { validate } from '../../middleware/validate.js';
import { AdminLoginController } from './admin-login.controller.js';
import type { AdminLoginRepository } from './admin-login.repository.js';
import { adminLoginRequestSchema } from './admin-login.schema.js';
import { AdminLoginService } from './admin-login.service.js';
import { createLoginRateLimit, LoginRateLimiter } from './login-rate-limiter.js';

export type AuthDependencies = {
  adminLoginRepository: AdminLoginRepository;
  loginRateLimiter?: LoginRateLimiter;
  browserAuth?: AdminBrowserAuthConfig;
};

export const createAuthRouter = (dependencies: AuthDependencies): Router => {
  const router = Router();
  const controller = new AdminLoginController(
    new AdminLoginService(dependencies.adminLoginRepository),
    dependencies.browserAuth ?? adminBrowserAuthConfig,
  );
  router.post('/login', createLoginRateLimit(dependencies.loginRateLimiter ?? new LoginRateLimiter()), validate(adminLoginRequestSchema), controller.login);
  router.post('/logout', controller.logout);
  return router;
};
