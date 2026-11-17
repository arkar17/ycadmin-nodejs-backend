import type { RequestHandler } from 'express';

import { AppError } from '../shared/app-error.js';

/** Requires every named permission, matching the shared backend's RBAC convention. */
export const requirePermission = (...requiredPermissions: string[]): RequestHandler => (request, _response, next) => {
  if (!request.auth) {
    return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
  }

  if (request.auth.isSystemAdmin) return next();

  const authorized = requiredPermissions.every((permission) => request.auth?.permissions.includes(permission));
  if (!authorized) {
    return next(new AppError({ statusCode: 403, code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' }));
  }

  return next();
};

/** Restricts security-sensitive account management to a database-hydrated System Admin. */
export const requireSystemAdmin: RequestHandler = (request, _response, next) => {
  if (!request.auth) {
    return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
  }
  if (!request.auth.isSystemAdmin) {
    return next(new AppError({ statusCode: 403, code: 'SYSTEM_ADMIN_REQUIRED', message: 'A current System Admin is required for this operation.' }));
  }
  return next();
};
