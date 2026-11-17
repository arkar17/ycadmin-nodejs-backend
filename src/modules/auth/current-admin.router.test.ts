import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from './admin-identity.repository.js';
import type { CurrentAdminRepository } from './current-admin.repository.js';
import { createCurrentAdminRouter } from './current-admin.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = () => jwt.sign({ id: 7, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });

const identity = (roleNames: string[] = ['Manager']): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({
    id: 7,
    displayName: 'Admin User',
    roleNames,
    permissionNames: ['member:list'],
  })),
});

const appFor = (repository: CurrentAdminRepository, adminIdentityRepository = identity()) => {
  const app = express();
  app.use('/api/admin/v1/auth', createCurrentAdminRouter({ adminIdentityRepository, currentAdminRepository: repository }));
  app.use(errorHandler);
  return app;
};

const currentRecord = {
  id: 7,
  name: 'Admin User',
  email: 'admin@example.test',
  username: 'admin-user',
  status: Status.ACTIVE,
  roles: [
    {
      id: 3,
      name: 'Manager',
      status: Status.ACTIVE,
      permissions: [
        { id: 5, name: 'member:list', description: 'List members', status: Status.ACTIVE },
        { id: 6, name: 'member:delete', description: null, status: Status.INACTIVE },
      ],
    },
    {
      id: 4,
      name: 'Old Role',
      status: Status.INACTIVE,
      permissions: [{ id: 8, name: 'role:list', description: null, status: Status.ACTIVE }],
    },
  ],
};

describe('Current Admin identity router', () => {
  it('returns a safe identity from current active roles and permissions without requiring a feature permission', async () => {
    const repository: CurrentAdminRepository = { findById: vi.fn(async () => currentRecord) };
    const response = await request(appFor(repository)).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      id: 7,
      name: 'Admin User',
      email: 'admin@example.test',
      username: 'admin-user',
      status: 'ACTIVE',
      roles: [{ id: 3, name: 'Manager' }],
      permissions: [{ id: 5, name: 'member:list', description: 'List members' }],
      isSystemAdmin: false,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/password|token|secret/i);
  });

  it('derives System Admin status from the currently hydrated active role', async () => {
    const repository: CurrentAdminRepository = {
      findById: vi.fn(async () => ({
        ...currentRecord,
        roles: [{ id: 1, name: 'SuperAdmin', status: Status.ACTIVE, permissions: [] }],
      })),
    };
    const response = await request(appFor(repository, identity(['SuperAdmin'])))
      .get('/api/admin/v1/auth/me')
      .set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(200);
    expect(response.body.data.isSystemAdmin).toBe(true);
  });
});
