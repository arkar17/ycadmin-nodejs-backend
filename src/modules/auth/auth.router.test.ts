import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from './admin-identity.repository.js';
import type { AdminLoginRepository } from './admin-login.repository.js';
import { createAuthRouter } from './auth.router.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { createMemberDirectoryRouter } from '../members/member-directory.router.js';
import type { MemberDirectoryRepository } from '../members/member-directory.repository.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const password = 'correct horse battery staple';
const account = async () => ({ id: 7, name: 'Login Admin', username: 'login-admin', passwordHash: await bcrypt.hash(password, 10) });
const memberDirectory: MemberDirectoryRepository = { findPage: vi.fn(async () => ({ records: [], total: 0 })) };

const app = async (repository: AdminLoginRepository, identity?: AdminIdentityRepository, limiter = new LoginRateLimiter()) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/auth', createAuthRouter({ adminLoginRepository: repository, loginRateLimiter: limiter }));
  if (identity) value.use('/api/admin/v1/members', createMemberDirectoryRouter({ adminIdentityRepository: identity, memberDirectoryRepository: memberDirectory }));
  value.use(errorHandler);
  return value;
};

describe('Admin login router', () => {
  it('verifies a shared bcrypt password and returns an expiring Admin-only JWT without a hash', async () => {
    const loginAccount = await account();
    const value = await app({ findActiveByEmailOrUsername: vi.fn(async () => loginAccount) });
    const response = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ tokenType: 'Bearer', user: { id: 7, name: 'Login Admin', username: 'login-admin' } });
    expect(response.body.data).not.toHaveProperty('password');
    expect(JSON.stringify(response.body)).not.toContain(loginAccount.passwordHash);
    const claims = jwt.verify(response.body.data.accessToken, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ id: 7, loginType: 'admin' });
    expect(typeof claims.exp).toBe('number');
    expect(new Date(response.body.data.expiresAt).getTime()).toBe(claims.exp! * 1000);
  });

  it('uses generic failures for wrong credentials, inactive/missing accounts, and malformed bodies', async () => {
    const loginAccount = await account();
    const wrongPassword = await request(await app({ findActiveByEmailOrUsername: vi.fn(async () => loginAccount) })).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password: 'incorrect' });
    const inactive = await request(await app({ findActiveByEmailOrUsername: vi.fn(async () => null) })).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'inactive-admin', password });
    const malformed = await request(await app({ findActiveByEmailOrUsername: vi.fn() })).post('/api/admin/v1/auth/login').send({ username: 'login-admin', password, extra: true });
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(inactive.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).toBe(inactive.body.error.message);
    expect(malformed.status).toBe(422);
  });

  it('throttles repeated login attempts without including credentials in the response', async () => {
    const value = await app({ findActiveByEmailOrUsername: vi.fn(async () => null) }, undefined, new LoginRateLimiter(2, 60_000));
    const first = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'admin', password: 'wrong' });
    const second = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'admin', password: 'wrong' });
    const third = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'admin', password: 'wrong' });
    expect([first.status, second.status, third.status]).toEqual([401, 401, 429]);
    expect(third.body.error.code).toBe('LOGIN_THROTTLED');
    expect(JSON.stringify(third.body)).not.toContain('wrong');
  });

  it('does not make a token a permission snapshot: revoked permissions are rehydrated on every protected request', async () => {
    const loginAccount = await account();
    const permissionNames: string[] = ['member:list'];
    const identity: AdminIdentityRepository = { findActiveAdminById: vi.fn(async () => ({ id: 7, displayName: 'Login Admin', roleNames: ['Role'], permissionNames })) };
    const value = await app({ findActiveByEmailOrUsername: vi.fn(async () => loginAccount) }, identity);
    const login = await request(value).post('/api/admin/v1/auth/login').send({ emailOrUsername: 'login-admin', password });
    permissionNames.splice(0);
    const protectedResponse = await request(value).get('/api/admin/v1/members').set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(protectedResponse.status).toBe(403);
  });
});
