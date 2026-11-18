import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';

import { adminBrowserAuthConfig, type AdminBrowserAuthConfig } from '../config/admin-browser-auth.js';
import { env } from '../config/env.js';
import {
  PrismaAdminIdentityRepository,
  type AdminIdentityRepository,
} from '../modules/auth/admin-identity.repository.js';
import { hasSystemAdminRole } from '../modules/auth/admin-access-policy.js';
import { isUnsafeMethod, readBrowserAuthCookie, requireAllowedBrowserOrigin } from '../modules/auth/browser-auth.js';
import { AppError } from '../shared/app-error.js';

export type SharedAdminTokenClaims = jwt.JwtPayload & { id: number; loginType: 'admin' };

const defaultAdminIdentityRepository = new PrismaAdminIdentityRepository();

export const createAuthenticateAdmin = (
  repository: AdminIdentityRepository,
  browserAuth: AdminBrowserAuthConfig = adminBrowserAuthConfig,
): RequestHandler => async (
  request,
  _response,
  next,
) => {
  const authorization = request.header('authorization');
  let token: string | undefined;
  let transport: 'bearer' | 'browser-cookie' | undefined;

  if (authorization !== undefined) {
    const match = /^Bearer (.+)$/i.exec(authorization);
    if (!match || !match[1]) {
      return next(new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' }));
    }
    token = match[1];
    transport = 'bearer';
  } else if (browserAuth.enabled) {
    try {
      token = readBrowserAuthCookie(request, browserAuth.cookieName);
    } catch (error) {
      return next(error);
    }
    if (token) transport = 'browser-cookie';
  }

  if (!token) {
    return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
  }

  if (transport === 'browser-cookie' && isUnsafeMethod(request.method)) {
    try {
      requireAllowedBrowserOrigin(request, browserAuth);
    } catch (error) {
      return next(error);
    }
  }

  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' }));
  }

  if (
    typeof decoded === 'string' ||
    decoded.loginType !== 'admin' ||
    !Number.isSafeInteger(decoded.id) ||
    decoded.id <= 0
  ) {
    return next(new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' }));
  }

  let identity: Awaited<ReturnType<AdminIdentityRepository['findActiveAdminById']>>;
  try {
    identity = await repository.findActiveAdminById(decoded.id);
  } catch (error) {
    // Infrastructure failures are not authentication failures. Preserve the
    // original error for the centralized handler and structured request log.
    return next(error);
  }

  if (!identity) {
    return next(new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' }));
  }

  request.auth = {
    userId: identity.id,
    displayName: identity.displayName,
    roles: identity.roleNames,
    permissions: identity.permissionNames,
    isSystemAdmin: hasSystemAdminRole(identity.roleNames),
    transport: transport!,
  };
  return next();
};

/** Uses the verified schema-backed User/RBAC repository in production wiring. */
export const authenticateAdmin = createAuthenticateAdmin(defaultAdminIdentityRepository);
