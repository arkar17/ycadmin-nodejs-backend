import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import {
  PrismaAdminIdentityRepository,
  type AdminIdentityRepository,
} from '../modules/auth/admin-identity.repository.js';
import { AppError } from '../shared/app-error.js';

export type SharedAdminTokenClaims = jwt.JwtPayload & { id: number; loginType: 'admin' };

const defaultAdminIdentityRepository = new PrismaAdminIdentityRepository();

export const createAuthenticateAdmin = (repository: AdminIdentityRepository): RequestHandler => async (
  request,
  _response,
  next,
) => {
  const authorization = request.header('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

  if (!token) {
    return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (
      typeof decoded === 'string' ||
      decoded.loginType !== 'admin' ||
      !Number.isSafeInteger(decoded.id) ||
      decoded.id <= 0
    ) {
      return next(new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' }));
    }

    const identity = await repository.findActiveAdminById(decoded.id);
    if (!identity) {
      return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
    }

    request.auth = {
      userId: identity.id,
      displayName: identity.displayName,
      roles: identity.roleNames,
      permissions: identity.permissionNames,
    };
    return next();
  } catch {
    return next(new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' }));
  }
};

/** Uses the verified schema-backed User/RBAC repository in production wiring. */
export const authenticateAdmin = createAuthenticateAdmin(defaultAdminIdentityRepository);
