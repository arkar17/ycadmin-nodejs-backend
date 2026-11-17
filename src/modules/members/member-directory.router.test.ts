import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createMemberDirectoryRouter } from './member-directory.router.js';
import type { MemberDirectoryPage, MemberDirectoryRepository } from './member-directory.repository.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const authorizedIdentityRepository = (): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({
    id: 1,
    displayName: 'Directory Admin',
    roleNames: ['SuperAdmin'],
    permissionNames: ['member:list'],
  })),
});

const repositoryFor = (page: MemberDirectoryPage): MemberDirectoryRepository => ({
  findPage: vi.fn(async () => page),
});

const createApp = (
  memberDirectoryRepository: MemberDirectoryRepository,
  adminIdentityRepository: AdminIdentityRepository = authorizedIdentityRepository(),
) => {
  const app = express();
  app.use('/api/admin/v1/members', createMemberDirectoryRouter({ adminIdentityRepository, memberDirectoryRepository }));
  app.use(errorHandler);
  return app;
};

const adminToken = (payload: object = { id: 1, loginType: 'admin' }) =>
  jwt.sign(payload, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

const member = {
  id: 11,
  code: 'YC0011',
  name: 'Ada Member',
  clientType: 'gym_member' as const,
  phone: '+959123456789',
  email: 'ada@example.test',
  profile: { gender: 'FEMALE' as const, address: 'Yangon' },
};

describe('Member Directory Stage 1 router', () => {
  it('requires authenticated Admin access and member:list permission', async () => {
    const repository = repositoryFor({ records: [], total: 0 });
    const noToken = await request(createApp(repository)).get('/api/admin/v1/members');
    const noPermission = await request(
      createApp(repository, {
        findActiveAdminById: vi.fn(async () => ({
          id: 1,
          displayName: 'No Permission',
          roleNames: ['Synthetic Role'],
          permissionNames: [],
        })),
      }),
    )
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(noToken.status).toBe(401);
    expect(noPermission.status).toBe(403);
  });

  it('returns safe paginated DTOs and deterministic pagination metadata', async () => {
    const repository = repositoryFor({ records: [member], total: 2 });
    const response = await request(createApp(repository))
      .get('/api/admin/v1/members?limit=1&offset=1')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        {
          id: 11,
          clientCode: 'YC0011',
          name: 'Ada Member',
          clientType: 'gym_member',
          phone: '+959123456789',
          email: 'ada@example.test',
          gender: 'FEMALE',
          address: 'Yangon',
          memberPlan: null,
        },
      ],
      pagination: { total: 2, limit: 1, offset: 1, currentPage: 2, totalPages: 2 },
    });
    expect(repository.findPage).toHaveBeenCalledWith({ limit: 1, offset: 1 });
  });

  it('passes combined name and phone/email search to the repository', async () => {
    const repository = repositoryFor({ records: [], total: 0 });
    const response = await request(createApp(repository))
      .get('/api/admin/v1/members?name=Ada&contact=%2B959&limit=20&offset=0')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(repository.findPage).toHaveBeenCalledWith({ name: 'Ada', contact: '+959', limit: 20, offset: 0 });
  });

  it('returns an empty result collection', async () => {
    const response = await request(createApp(repositoryFor({ records: [], total: 0 })))
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { total: 0, limit: 20, offset: 0, currentPage: 1, totalPages: 0 },
    });
  });

  it('rejects malformed pagination and unsupported member-plan filtering', async () => {
    const repository = repositoryFor({ records: [], total: 0 });
    const app = createApp(repository);

    const malformed = await request(app)
      .get('/api/admin/v1/members?offset=-1')
      .set('Authorization', `Bearer ${adminToken()}`);
    const unsupportedPlan = await request(app)
      .get('/api/admin/v1/members?memberPlanId=4')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(malformed.status).toBe(422);
    expect(unsupportedPlan.status).toBe(422);
    expect(unsupportedPlan.body.error.details[0]).toMatchObject({ field: 'query.memberPlanId' });
    expect(unsupportedPlan.body.error.details[0].message).toContain('Member-plan filtering is unavailable');
    expect(repository.findPage).not.toHaveBeenCalled();
  });

  it('excludes sensitive and storage-only fields even if a repository implementation supplied them', async () => {
    const sensitiveRecord = {
      ...member,
      password: 'password-hash',
      profile: { ...member.profile, profilePhoto: 'https://storage.example/profile.jpg', profilePhotoKey: 'private-key' },
    } as unknown as MemberDirectoryPage['records'][number];
    const response = await request(createApp(repositoryFor({ records: [sensitiveRecord], total: 1 })))
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken()}`);

    const item = response.body.data[0];
    expect(item).not.toHaveProperty('password');
    expect(item).not.toHaveProperty('profilePhoto');
    expect(item).not.toHaveProperty('profilePhotoKey');
    expect(item).not.toHaveProperty('attendanceSubjectId');
  });
});
