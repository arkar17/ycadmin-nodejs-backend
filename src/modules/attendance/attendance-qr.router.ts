import { Router } from 'express';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { AttendanceQrController } from './attendance-qr.controller.js';
import type { AttendanceQrCredentialOperations } from './attendance-qr-credential.service.js';
import { attendanceQrCreateRequestSchema } from './attendance-qr.schema.js';

export type AttendanceQrDependencies = {
  adminIdentityRepository: AdminIdentityRepository;
  credentialService: AttendanceQrCredentialOperations;
};

export const createAttendanceQrRouter = (dependencies: AttendanceQrDependencies): Router => {
  const router = Router();
  const authenticateAdmin = createAuthenticateAdmin(dependencies.adminIdentityRepository);
  const controller = new AttendanceQrController(dependencies.credentialService);

  router.post('/', authenticateAdmin, requirePermission('attendance-qr:create'), validate(attendanceQrCreateRequestSchema), controller.create);
  router.get('/', authenticateAdmin, requirePermission('attendance-qr:read'), controller.retrieve);

  return router;
};
