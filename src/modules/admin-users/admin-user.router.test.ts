import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { AdminUserRepository } from './admin-user.repository.js';
import { createAdminUserRouter } from './admin-user.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = () => jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const identity = (permissions: string[], roleNames = ['Manager']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Reader', roleNames, permissionNames: permissions })),
});
const dates = { createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z') };
const listUser = { id: 9, name: 'Nine', email: 'nine@example.test', username: 'nine', status: Status.ACTIVE, roles: [{ id: 2, name: 'Manager' }], ...dates };
const repository = (): AdminUserRepository => ({ findPage: vi.fn(async () => ({ records: [listUser], total: 1 })), findById: vi.fn(async () => null) });
const appFor = (users: AdminUserRepository, auth: AdminIdentityRepository) => {
  const app = express();
  app.use('/api/admin/v1/users', createAdminUserRouter({ adminIdentityRepository: auth, adminUserRepository: users }));
  app.use(errorHandler);
  return app;
};

describe('Admin user read routers', () => {
  it('requires user:list for a normal Admin and permits the System Admin bypass', async () => {
    const users = repository();
    const forbidden = await request(appFor(users, identity([]))).get('/api/admin/v1/users').set('Authorization', `Bearer ${token()}`);
    const allowed = await request(appFor(users, identity([], ['SuperAdmin']))).get('/api/admin/v1/users').set('Authorization', `Bearer ${token()}`);
    expect(forbidden.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('validates and forwards filters/pagination and returns only a safe paginated DTO', async () => {
    const users = repository();
    const response = await request(appFor(users, identity(['user:list'])))
      .get('/api/admin/v1/users?search=Nine&status=ACTIVE&role=Manager&limit=10&offset=20')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(users.findPage).toHaveBeenCalledWith({ search: 'Nine', status: 'ACTIVE', role: 'Manager', limit: 10, offset: 20 });
    expect(response.body.pagination).toEqual({ total: 1, limit: 10, offset: 20, currentPage: 3, totalPages: 1 });
    expect(response.body.data[0]).toMatchObject({ id: 9, roles: [{ id: 2, name: 'Manager' }], isSystemAdmin: false });
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|secret/i);
  });

  it('returns role status and the union of active permissions on detail', async () => {
    const users: AdminUserRepository = {
      findPage: vi.fn(async () => ({ records: [], total: 0 })),
      findById: vi.fn(async () => ({
        ...listUser,
        roles: [
          { id: 1, name: 'SuperAdmin', status: Status.ACTIVE, permissions: [{ id: 1, name: 'user:read', description: null, status: Status.ACTIVE }] },
          { id: 2, name: 'Inactive', status: Status.INACTIVE, permissions: [{ id: 2, name: 'user:delete', description: null, status: Status.ACTIVE }] },
        ],
      })),
    };
    const response = await request(appFor(users, identity(['user:read'])))
      .get('/api/admin/v1/users/9')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ isSystemAdmin: true, permissions: [{ id: 1, name: 'user:read', description: null }] });
    expect(response.body.data.roles).toHaveLength(2);
  });

  it('requires user:read, rejects invalid IDs, and returns NOT_FOUND for a missing user', async () => {
    const users = repository();
    const forbidden = await request(appFor(users, identity(['user:list']))).get('/api/admin/v1/users/9').set('Authorization', `Bearer ${token()}`);
    const invalid = await request(appFor(users, identity(['user:read']))).get('/api/admin/v1/users/nope').set('Authorization', `Bearer ${token()}`);
    const missing = await request(appFor(users, identity(['user:read']))).get('/api/admin/v1/users/9').set('Authorization', `Bearer ${token()}`);
    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(422);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
