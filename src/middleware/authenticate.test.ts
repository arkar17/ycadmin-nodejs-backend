import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../modules/auth/admin-identity.repository.js';
import { requirePermission } from './authorize.js';
import { createAuthenticateAdmin } from './authenticate.js';
import { errorHandler } from './error-handler.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const createRepository = (identity: Awaited<ReturnType<AdminIdentityRepository['findActiveAdminById']>>) => {
  const findActiveAdminById = vi.fn(async () => identity);
  return { findActiveAdminById } satisfies AdminIdentityRepository;
};

const createProtectedApp = (repository: AdminIdentityRepository) => {
  const app = express();
  app.get(
    '/protected',
    createAuthenticateAdmin(repository),
    requirePermission('member:list'),
    (request, response) => response.json({ data: { userId: request.auth?.userId } }),
  );
  app.use(errorHandler);
  return app;
};

const sign = (payload: object, options: jwt.SignOptions = {}) =>
  jwt.sign(payload, signingSecret, { algorithm: 'HS256', ...options });

describe('Admin authentication and authorization', () => {
  it('rejects a missing token', async () => {
    const response = await request(createProtectedApp(createRepository(null))).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects malformed and expired tokens', async () => {
    const repository = createRepository(null);
    const app = createProtectedApp(repository);

    const malformed = await request(app).get('/protected').set('Authorization', 'Bearer not-a-jwt');
    const expired = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 1, loginType: 'admin' }, { expiresIn: -1 })}`);

    expect(malformed.status).toBe(401);
    expect(expired.status).toBe(401);
    expect(repository.findActiveAdminById).not.toHaveBeenCalled();
  });

  it('rejects incorrectly typed token IDs and Member tokens before User lookup', async () => {
    const repository = createRepository({
      id: 1,
      displayName: 'Overlapping ID User',
      roleNames: ['SuperAdmin'],
      permissionNames: ['member:list'],
    });
    const app = createProtectedApp(repository);

    const invalidId = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: '1', loginType: 'admin' })}`);
    const memberToken = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 1, loginType: 'member' })}`);

    expect(invalidId.status).toBe(401);
    expect(memberToken.status).toBe(401);
    expect(repository.findActiveAdminById).not.toHaveBeenCalled();
  });

  it('rejects inactive or nonexistent Admin accounts returned by the repository', async () => {
    const repository = createRepository(null);
    const response = await request(createProtectedApp(repository))
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 7, loginType: 'admin' })}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(repository.findActiveAdminById).toHaveBeenCalledWith(7);
  });

  it('rejects an Admin whose current permission has been removed', async () => {
    const repository = createRepository({
      id: 2,
      displayName: 'Permission Revoked',
      roleNames: ['SuperAdmin'],
      permissionNames: [],
    });
    const response = await request(createProtectedApp(repository))
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 2, loginType: 'admin' })}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('authorizes an active Admin with the required current permission', async () => {
    const repository = createRepository({
      id: 3,
      displayName: 'Authorized Admin',
      roleNames: ['SuperAdmin'],
      permissionNames: ['member:list'],
    });
    const response = await request(createProtectedApp(repository))
      .get('/protected')
      .set('Authorization', `Bearer ${sign({ id: 3, loginType: 'admin' })}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { userId: 3 } });
  });
});
