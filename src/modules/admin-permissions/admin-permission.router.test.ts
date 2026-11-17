import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { AdminPermissionRepository } from './admin-permission.repository.js';
import { createAdminPermissionRouter } from './admin-permission.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = () => jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const identity = (permissions: string[], roleNames = ['Manager']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Reader', roleNames, permissionNames: permissions })),
});
const dates = { createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-02T00:00:00.000Z') };
const permission = { id: 8, name: 'member-plan:list', description: 'List plans', status: Status.ACTIVE, ...dates };
const repository = (): AdminPermissionRepository => ({ findPage: vi.fn(async () => ({ records: [permission], total: 1 })), findById: vi.fn(async () => null) });
const appFor = (permissions: AdminPermissionRepository, auth: AdminIdentityRepository) => {
  const app = express();
  app.use('/api/admin/v1/permissions', createAdminPermissionRouter({ adminIdentityRepository: auth, adminPermissionRepository: permissions }));
  app.use(errorHandler);
  return app;
};

describe('Admin permission read routers', () => {
  it('enforces permission:list/read for normal Admins', async () => {
    const permissions = repository();
    const list = await request(appFor(permissions, identity([]))).get('/api/admin/v1/permissions').set('Authorization', `Bearer ${token()}`);
    const detail = await request(appFor(permissions, identity(['permission:list']))).get('/api/admin/v1/permissions/8').set('Authorization', `Bearer ${token()}`);
    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
  });

  it('passes status and resource-prefix filters and returns stored permission names unchanged', async () => {
    const permissions = repository();
    const response = await request(appFor(permissions, identity(['permission:list'])))
      .get('/api/admin/v1/permissions?search=plan&status=ACTIVE&resourcePrefix=member-plan&limit=5&offset=0')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(permissions.findPage).toHaveBeenCalledWith({ search: 'plan', status: 'ACTIVE', resourcePrefix: 'member-plan', limit: 5, offset: 0 });
    expect(response.body.data[0].name).toBe('member-plan:list');
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|secret/i);
  });

  it('allows System Admin bypass and returns safe role metadata on detail', async () => {
    const permissions: AdminPermissionRepository = {
      findPage: vi.fn(async () => ({ records: [], total: 0 })),
      findById: vi.fn(async () => ({ ...permission, roles: [
        { id: 1, name: 'SuperAdmin', status: Status.ACTIVE },
        { id: 2, name: 'Archived', status: Status.INACTIVE },
      ] })),
    };
    const response = await request(appFor(permissions, identity([], ['SuperAdmin'])))
      .get('/api/admin/v1/permissions/8')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.roles).toEqual([
      { id: 2, name: 'Archived', status: 'INACTIVE', isSystemRole: false },
      { id: 1, name: 'SuperAdmin', status: 'ACTIVE', isSystemRole: true },
    ]);
  });

  it('supports explicit inactive catalogue filtering and reports missing permissions', async () => {
    const permissions = repository();
    const filtered = await request(appFor(permissions, identity(['permission:list'])))
      .get('/api/admin/v1/permissions?status=INACTIVE')
      .set('Authorization', `Bearer ${token()}`);
    const missing = await request(appFor(permissions, identity(['permission:read'])))
      .get('/api/admin/v1/permissions/999')
      .set('Authorization', `Bearer ${token()}`);
    expect(filtered.status).toBe(200);
    expect(permissions.findPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'INACTIVE' }));
    expect(missing.status).toBe(404);
  });
});
