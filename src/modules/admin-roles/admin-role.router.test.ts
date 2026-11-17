import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { AdminRoleRepository } from './admin-role.repository.js';
import { createAdminRoleRouter } from './admin-role.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = () => jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const identity = (permissions: string[], roleNames = ['Manager']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Reader', roleNames, permissionNames: permissions })),
});
const dates = { createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z') };
const role = { id: 1, name: 'SuperAdmin', description: 'System administrators', status: Status.ACTIVE, permissionsCount: 4, assignedUsersCount: 2, ...dates };
const repository = (): AdminRoleRepository => ({ findPage: vi.fn(async () => ({ records: [role], total: 1 })), findById: vi.fn(async () => null) });
const appFor = (roles: AdminRoleRepository, auth: AdminIdentityRepository) => {
  const app = express();
  app.use('/api/admin/v1/roles', createAdminRoleRouter({ adminIdentityRepository: auth, adminRoleRepository: roles }));
  app.use(errorHandler);
  return app;
};

describe('Admin role read routers', () => {
  it('enforces role:list/read for normal Admins', async () => {
    const roles = repository();
    const list = await request(appFor(roles, identity([]))).get('/api/admin/v1/roles').set('Authorization', `Bearer ${token()}`);
    const detail = await request(appFor(roles, identity(['role:list']))).get('/api/admin/v1/roles/1').set('Authorization', `Bearer ${token()}`);
    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
  });

  it('returns counts and derives System Role metadata while preserving a normal role as false', async () => {
    const roles: AdminRoleRepository = {
      findPage: vi.fn(async () => ({ records: [role, { ...role, id: 2, name: 'Manager' }], total: 2 })),
      findById: vi.fn(async () => null),
    };
    const response = await request(appFor(roles, identity(['role:list'])))
      .get('/api/admin/v1/roles?search=admin&status=ACTIVE&limit=10&offset=0')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(roles.findPage).toHaveBeenCalledWith({ search: 'admin', status: 'ACTIVE', limit: 10, offset: 0 });
    expect(response.body.data.map((item: { isSystemRole: boolean }) => item.isSystemRole)).toEqual([true, false]);
    expect(response.body.data[0]).toMatchObject({ permissionsCount: 4, assignedUsersCount: 2 });
  });

  it('allows System Admin bypass and excludes inactive permissions from role detail', async () => {
    const roles: AdminRoleRepository = {
      findPage: vi.fn(async () => ({ records: [], total: 0 })),
      findById: vi.fn(async () => ({
        ...role,
        permissions: [
          { id: 3, name: 'role:read', description: 'Read roles', status: Status.ACTIVE },
          { id: 4, name: 'role:delete', description: null, status: Status.INACTIVE },
        ],
      })),
    };
    const response = await request(appFor(roles, identity([], ['SuperAdmin'])))
      .get('/api/admin/v1/roles/1')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.isSystemRole).toBe(true);
    expect(response.body.data.permissions).toEqual([{ id: 3, name: 'role:read', description: 'Read roles', status: 'ACTIVE' }]);
  });
});
