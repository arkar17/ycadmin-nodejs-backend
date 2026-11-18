import type { CookieOptions, Request, Response } from 'express';

import type { AdminBrowserAuthConfig } from '../../config/admin-browser-auth.js';
import { AppError } from '../../shared/app-error.js';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const csrfError = (code: string, message: string) => new AppError({ statusCode: 403, code, message });

export const isUnsafeMethod = (method: string): boolean => unsafeMethods.has(method.toUpperCase());

export const hasBrowserOriginMetadata = (request: Request): boolean =>
  request.header('origin') !== undefined || request.header('referer') !== undefined;

export const requireAllowedBrowserOrigin = (request: Request, config: AdminBrowserAuthConfig): void => {
  if (!config.enabled || !config.allowedOrigin) {
    throw csrfError('BROWSER_AUTH_DISABLED', 'Browser authentication is not available.');
  }

  const origin = request.header('origin');
  if (origin !== undefined) {
    if (origin !== config.allowedOrigin) {
      throw csrfError('CSRF_ORIGIN_MISMATCH', 'The request origin is not allowed.');
    }
    return;
  }

  const referer = request.header('referer');
  if (referer === undefined) {
    throw csrfError('CSRF_ORIGIN_REQUIRED', 'An allowed request origin is required.');
  }

  try {
    if (new URL(referer).origin !== config.allowedOrigin) {
      throw csrfError('CSRF_ORIGIN_MISMATCH', 'The request origin is not allowed.');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw csrfError('CSRF_ORIGIN_MISMATCH', 'The request origin is not allowed.');
  }
};

export const readBrowserAuthCookie = (request: Request, cookieName: string): string | undefined => {
  const header = request.header('cookie');
  if (!header) return undefined;

  const values = header
    .split(';')
    .map((part) => part.trim())
    .flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== cookieName) return [];
      return [part.slice(separator + 1)];
    });

  if (values.length === 0) return undefined;
  if (values.length !== 1 || values[0]!.length === 0) {
    throw new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
  }

  try {
    return decodeURIComponent(values[0]!);
  } catch {
    throw new AppError({ statusCode: 401, code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired.' });
  }
};

const cookieOptions = (config: AdminBrowserAuthConfig): CookieOptions => ({
  httpOnly: true,
  secure: config.secure,
  sameSite: config.sameSite,
  path: '/',
});

export const setBrowserAuthCookie = (response: Response, token: string, config: AdminBrowserAuthConfig): void => {
  response.cookie(config.cookieName, token, {
    ...cookieOptions(config),
    maxAge: config.maxAgeSeconds * 1000,
  });
};

export const clearBrowserAuthCookie = (response: Response, config: AdminBrowserAuthConfig): void => {
  response.clearCookie(config.cookieName, cookieOptions(config));
};
