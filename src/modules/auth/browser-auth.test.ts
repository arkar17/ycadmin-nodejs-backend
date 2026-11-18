import { Status } from '@prisma/client';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminBrowserAuthConfig } from '../../config/admin-browser-auth.js';
import { requirePermission } from '../../middleware/authorize.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from './admin-identity.repository.js';
import type { AdminLoginRepository } from './admin-login.repository.js';
import { createAuthRouter } from './auth.router.js';
import type { CurrentAdminRepository } from './current-admin.repository.js';
import { createCurrentAdminRouter } from './current-admin.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const password = 'correct horse battery staple';
const origin = 'https://admin.example.test';
const browserAuth: AdminBrowserAuthConfig = {
  enabled: true,
  cookieName: 'yc_admin_session',
  secure: true,
  sameSite: 'lax',
  maxAgeSeconds: 28_800,
  allowedOrigin: origin,
};

const loginAccount = async () => ({
  id: 7,
  name: 'Browser Admin',
  username: 'browser-admin',
  passwordHash: await bcrypt.hash(password, 10),
});

const currentRecord = {
  id: 7,
  name: 'Browser Admin',
  email: 'browser.admin@example.test',
  username: 'browser-admin',
  status: Status.ACTIVE,
  roles: [{
    id: 3,
    name: 'Manager',
    status: Status.ACTIVE,
    permissions: [{ id: 5, name: 'member:list', description: 'List members', status: Status.ACTIVE }],
  }],
};

const buildApp = async (options: {
  loginRepository?: AdminLoginRepository;
  identityRepository?: AdminIdentityRepository;
  currentAdminRepository?: CurrentAdminRepository;
} = {}) => {
  const account = await loginAccount();
  const identityRepository = options.identityRepository ?? {
    findActiveAdminById: vi.fn(async () => ({
      id: 7,
      displayName: 'Browser Admin',
      roleNames: ['Manager'],
      permissionNames: ['member:list'],
    })),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1/auth', createAuthRouter({
    adminLoginRepository: options.loginRepository ?? { findActiveByEmailOrUsername: vi.fn(async () => account) },
    browserAuth,
  }));
  app.use('/api/admin/v1/auth', createCurrentAdminRouter({
    adminIdentityRepository: identityRepository,
    currentAdminRepository: options.currentAdminRepository ?? { findById: vi.fn(async () => currentRecord) },
    browserAuth,
  }));
  app.get('/safe', createAuthenticateAdmin(identityRepository, browserAuth), (_request, response) => response.json({ data: 'ok' }));
  app.post(
    '/mutation',
    createAuthenticateAdmin(identityRepository, browserAuth),
    requirePermission('member:list'),
    (_request, response) => response.json({ data: 'changed' }),
  );
  app.use(errorHandler);
  return app;
};

const browserLogin = async (app: express.Express) => request(app)
  .post('/api/admin/v1/auth/login')
  .set('Origin', origin)
  .send({ emailOrUsername: 'browser-admin', password });

const cookieFrom = (response: request.Response): string => {
  const setCookie = response.headers['set-cookie'];
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error('Expected Set-Cookie header.');
  return value.split(';', 1)[0]!;
};

const signedCookie = (payload: object, options: jwt.SignOptions = {}): string => {
  const token = jwt.sign(payload, secret, { algorithm: 'HS256', ...options });
  return `${browserAuth.cookieName}=${token}`;
};

describe('Admin browser authentication transport', () => {
  it('sets a short secure HttpOnly cookie without returning its JWT', async () => {
    const response = await browserLogin(await buildApp());
    const setCookie = response.headers['set-cookie'] as unknown as string[];

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      authentication: 'browser-cookie',
      user: { id: 7, name: 'Browser Admin', username: 'browser-admin' },
    });
    expect(response.body.data).not.toHaveProperty('accessToken');
    expect(JSON.stringify(response.body)).not.toContain(cookieFrom(response).split('=', 2)[1]);
    expect(setCookie[0]).toContain('HttpOnly');
    expect(setCookie[0]).toContain('Secure');
    expect(setCookie[0]).toContain('SameSite=Lax');
    expect(setCookie[0]).toContain('Max-Age=28800');
    expect(setCookie[0]).toContain('Path=/');
  });

  it.each(['wrong-password', 'inactive-user', 'no-active-role'])('sets no cookie for %s', async (scenario) => {
    const account = await loginAccount();
    const repository: AdminLoginRepository = {
      findActiveByEmailOrUsername: vi.fn(async () => scenario === 'wrong-password' ? account : null),
    };
    const response = await request(await buildApp({ loginRepository: repository }))
      .post('/api/admin/v1/auth/login')
      .set('Origin', origin)
      .send({ emailOrUsername: scenario, password: scenario === 'wrong-password' ? 'incorrect' : password });

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('preserves origin-less bearer login compatibility', async () => {
    const response = await request(await buildApp())
      .post('/api/admin/v1/auth/login')
      .send({ emailOrUsername: 'browser-admin', password });

    expect(response.status).toBe(200);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('authenticates /auth/me through the browser cookie without a feature permission', async () => {
    const app = await buildApp();
    const login = await browserLogin(app);
    const response = await request(app).get('/api/admin/v1/auth/me').set('Cookie', cookieFrom(login));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 7,
      roles: [{ id: 3, name: 'Manager' }],
      permissions: [{ id: 5, name: 'member:list' }],
      isSystemAdmin: false,
    });
  });

  it('rejects malformed and expired browser JWT cookies', async () => {
    const app = await buildApp();
    const malformed = await request(app).get('/safe').set('Cookie', `${browserAuth.cookieName}=not-a-jwt`);
    const expired = await request(app).get('/safe').set('Cookie', signedCookie({ id: 7, loginType: 'admin' }, { expiresIn: -1 }));

    expect([malformed.status, expired.status]).toEqual([401, 401]);
    expect(malformed.body.error.code).toBe('INVALID_TOKEN');
    expect(expired.body.error.code).toBe('INVALID_TOKEN');
  });

  it('does not fall back to a valid cookie when an explicit Bearer token is invalid', async () => {
    const app = await buildApp();
    const login = await browserLogin(app);
    const response = await request(app)
      .get('/safe')
      .set('Authorization', 'Bearer invalid')
      .set('Cookie', cookieFrom(login));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rehydrates changed permissions and System Admin status from the repository', async () => {
    const roleNames = ['Manager'];
    const permissionNames = ['member:list'];
    const identityRepository: AdminIdentityRepository = {
      findActiveAdminById: vi.fn(async () => ({
        id: 7,
        displayName: 'Browser Admin',
        roleNames: [...roleNames],
        permissionNames: [...permissionNames],
      })),
    };
    const app = await buildApp({ identityRepository });
    const cookie = cookieFrom(await browserLogin(app));
    const before = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', origin);
    permissionNames.splice(0);
    const revoked = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', origin);
    roleNames.splice(0, 1, 'SuperAdmin');
    const systemAdmin = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', origin);

    expect(before.status).toBe(200);
    expect(revoked.status).toBe(403);
    expect(systemAdmin.status).toBe(200);
  });

  it('enforces exact Origin/Referer checks only for cookie-authenticated unsafe methods', async () => {
    const app = await buildApp();
    const login = await browserLogin(app);
    const cookie = cookieFrom(login);
    const valid = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', origin);
    const referer = await request(app).post('/mutation').set('Cookie', cookie).set('Referer', `${origin}/members`);
    const wrong = await request(app).post('/mutation').set('Cookie', cookie).set('Origin', 'https://attacker.example');
    const missing = await request(app).post('/mutation').set('Cookie', cookie);
    const safeGet = await request(app).get('/safe').set('Cookie', cookie);
    const bearer = await request(app)
      .post('/mutation')
      .set('Authorization', `Bearer ${login.body.data.accessToken ?? jwt.sign({ id: 7, loginType: 'admin' }, secret, { expiresIn: '1h' })}`);

    expect(valid.status).toBe(200);
    expect(referer.status).toBe(200);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('CSRF_ORIGIN_MISMATCH');
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_ORIGIN_REQUIRED');
    expect(safeGet.status).toBe(200);
    expect(bearer.status).toBe(200);
  });

  it('clears the browser cookie idempotently and leaves no browser credential', async () => {
    const app = await buildApp();
    const login = await browserLogin(app);
    const first = await request(app)
      .post('/api/admin/v1/auth/logout')
      .set('Cookie', cookieFrom(login))
      .set('Origin', origin);
    const repeated = await request(app)
      .post('/api/admin/v1/auth/logout')
      .set('Origin', origin);
    const after = await request(app).get('/safe');

    expect(first.status).toBe(204);
    expect(String(first.headers['set-cookie'])).toContain('yc_admin_session=;');
    expect(String(first.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(repeated.status).toBe(204);
    expect(after.status).toBe(401);
  });
});
