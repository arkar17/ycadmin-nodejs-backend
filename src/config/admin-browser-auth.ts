import { env } from './env.js';

export type AdminBrowserAuthConfig = {
  enabled: boolean;
  cookieName: string;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  maxAgeSeconds: number;
  allowedOrigin?: string;
};

export const adminBrowserAuthConfig: AdminBrowserAuthConfig = {
  enabled: env.ADMIN_BROWSER_AUTH_ENABLED,
  cookieName: env.ADMIN_AUTH_COOKIE_NAME,
  secure: env.ADMIN_AUTH_COOKIE_SECURE,
  sameSite: env.ADMIN_AUTH_COOKIE_SAME_SITE,
  maxAgeSeconds: env.ADMIN_AUTH_COOKIE_MAX_AGE_SECONDS,
  ...(env.ADMIN_AUTH_ALLOWED_ORIGIN ? { allowedOrigin: env.ADMIN_AUTH_ALLOWED_ORIGIN } : {}),
};
