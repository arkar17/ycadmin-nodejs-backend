import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { MemberTypeRecord, MemberTypeRepository } from './member-type.repository.js';
import { createMemberTypeRouter } from './member-type.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const record = (id: number, name: string, status: Status): MemberTypeRecord => ({ id, name, status, createdAt: new Date('2026-01-01T00:00:00.000Z') });

const identityRepository = (permissions: string[]): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Member Type Admin', roleNames: ['Synthetic Role'], permissionNames: permissions })),
});

const repositoryFor = (records: MemberTypeRecord[]): MemberTypeRepository => ({
  findPage: vi.fn(async ({ name, status, limit, offset }) => {
    const matches = records.filter((item) => (!name || item.name.toLowerCase().includes(name.toLowerCase())) && (!status || item.status === status));
    return { records: matches.slice(offset, offset + limit), total: matches.length };
  }),
});

const createApp = (repository: MemberTypeRepository, permissions = ['member-type:list']) => {
  const app = express();
  app.use('/api/admin/v1/member-types', createMemberTypeRouter({ adminIdentityRepository: identityRepository(permissions), memberTypeRepository: repository }));
  app.use(errorHandler);
  return app;
};

const token = () => jwt.sign({ id: 1, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Member Type router', () => {
  it('requires an authenticated Admin with member-type:list', async () => {
    const repository = repositoryFor([]);
    const missingToken = await request(createApp(repository)).get('/api/admin/v1/member-types');
    const missingPermission = await request(createApp(repository, []))
      .get('/api/admin/v1/member-types')
      .set('Authorization', `Bearer ${token()}`);

    expect(missingToken.status).toBe(401);
    expect(missingPermission.status).toBe(403);
  });

  it('returns only safe MemberType fields with filtered deterministic pagination', async () => {
    const response = await request(createApp(repositoryFor([
      record(3, 'Trainer Member', Status.ACTIVE),
      record(2, 'Gym Member', Status.ACTIVE),
      record(1, 'Archived Member', Status.INACTIVE),
    ])))
      .get('/api/admin/v1/member-types?name=Member&status=ACTIVE&limit=1&offset=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [{ id: 2, name: 'Gym Member', status: 'ACTIVE' }], pagination: { total: 2, limit: 1, offset: 1, currentPage: 2, totalPages: 2 } });
  });

  it('rejects malformed filters and does not expose Plan Level fields', async () => {
    const response = await request(createApp(repositoryFor([record(1, 'Gym Member', Status.ACTIVE)])))
      .get('/api/admin/v1/member-types?status=UNKNOWN')
      .set('Authorization', `Bearer ${token()}`);
    const safeResponse = await request(createApp(repositoryFor([record(1, 'Gym Member', Status.ACTIVE)])))
      .get('/api/admin/v1/member-types')
      .set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(422);
    expect(safeResponse.body.data[0]).not.toHaveProperty('levelCount');
    expect(safeResponse.body.data[0]).not.toHaveProperty('postLimitCount');
  });
});
