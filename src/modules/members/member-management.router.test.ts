import { Gender, MemberRequestStatus, Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { MemberDirectoryRepository } from './member-directory.repository.js';
import { createMemberDirectoryRouter } from './member-directory.router.js';
import type {
  MemberManagementRecord,
  MemberManagementRepository,
} from './member-management.repository.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = () => jwt.sign({ id: 17, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

const identity = (permissions: string[], roles: string[] = []): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({
    id: 17,
    displayName: 'Member Admin',
    roleNames: roles,
    permissionNames: permissions,
  })),
});

const record = (): MemberManagementRecord => ({
  id: 9,
  code: 'YC0009',
  name: 'Safe Member',
  email: 'safe@example.test',
  phone: '09123456789',
  countryCode: '+95',
  status: Status.ACTIVE,
  clientType: 'trainer',
  language: 'ENG',
  theme: 'LIGHT',
  memberType: { id: 4, name: 'Trainer', status: Status.ACTIVE },
  profile: {
    address: 'Yangon',
    bio: 'Coach',
    gender: Gender.FEMALE,
    age: 30,
    yearOfExp: 5,
    reason: 'Help members train safely',
    hasProfilePhoto: true,
    hasCoverPhoto: false,
    hasCertificates: true,
    hasPhotos: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
  createdBy: { id: 1, name: 'Creator' },
  updatedBy: { id: 2, name: 'Updater' },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  latestMemberRequest: {
    id: 30,
    status: MemberRequestStatus.APPROVED,
    requestedMemberType: { id: 4, name: 'Trainer' },
    requestedMemberPlan: { id: 8, name: 'Trainer Annual', price: 100, durationMonths: 12 },
    approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    rejectedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
  shop: {
    id: 6,
    name: 'Safe Shop',
    status: Status.ACTIVE,
    hasLogo: true,
    level: { id: 3, name: 'Gold', status: Status.ACTIVE },
  },
  attendance: { total: 2, lastCheckedInAt: new Date('2026-01-03T00:00:00.000Z') },
});

const directory: MemberDirectoryRepository = { findPage: vi.fn(async () => ({ records: [], total: 0 })) };

const repository = (member: MemberManagementRecord | null = record()): MemberManagementRepository => ({
  findById: vi.fn(async () => member),
  update: vi.fn(async (_id, _actor, input) => ({
    changed: true,
    member: { ...record(), ...input, profile: record().profile },
  })),
  setStatus: vi.fn(async (_id, _actor, status) => ({
    changed: status !== member?.status,
    member: { ...(member ?? record()), status },
  })),
});

const app = (management: MemberManagementRepository, permissions: string[], roles: string[] = []) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/members', createMemberDirectoryRouter({
    adminIdentityRepository: identity(permissions, roles),
    memberDirectoryRepository: directory,
    memberManagementRepository: management,
  }));
  value.use(errorHandler);
  return value;
};

describe('Member management router', () => {
  it('requires member:read, allows the System Admin bypass, and returns 404 for a missing member', async () => {
    const forbidden = await request(app(repository(), [])).get('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`);
    const bypass = await request(app(repository(), [], ['SuperAdmin'])).get('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`);
    const missing = await request(app(repository(null), ['member:read'])).get('/api/admin/v1/members/999').set('Authorization', `Bearer ${token()}`);

    expect(forbidden.status).toBe(403);
    expect(bypass.status).toBe(200);
    expect(missing.status).toBe(404);
  });

  it('returns the safe detail shape with type, profile, request, Shop and attendance summaries', async () => {
    const response = await request(app(repository(), ['member:read'])).get('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 9,
      memberType: { id: 4, name: 'Trainer' },
      profile: { yearOfExp: 5, hasCertificates: true },
      latestMemberRequest: { id: 30, requestedMemberPlan: { name: 'Trainer Annual' } },
      shop: { id: 6, hasLogo: true, level: { name: 'Gold' } },
      attendance: { total: 2 },
    });
    const serialized = JSON.stringify(response.body);
    for (const secret of ['password', 'token', 'profilePhoto', 'coverPhoto', 'certificates', 'photos', 'logo']) {
      expect(serialized).not.toContain(`\"${secret}\"`);
    }
  });

  it('requires member:update and accepts only supported strict PATCH fields', async () => {
    const management = repository();
    const forbidden = await request(app(management, ['member:read']))
      .patch('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`).send({ name: 'New Name' });
    const unknown = await request(app(management, ['member:update']))
      .patch('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`).send({ memberTypeId: 2 });
    const empty = await request(app(management, ['member:update']))
      .patch('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`).send({});
    const valid = await request(app(management, ['member:update']))
      .patch('/api/admin/v1/members/9').set('Authorization', `Bearer ${token()}`)
      .send({ name: ' New Name ', email: 'NEW@EXAMPLE.TEST', address: 'Mandalay', age: 31 });

    expect(forbidden.status).toBe(403);
    expect(unknown.status).toBe(422);
    expect(empty.status).toBe(422);
    expect(valid.status).toBe(200);
    expect(management.update).toHaveBeenCalledWith(9, 17, {
      name: 'New Name', email: 'new@example.test', address: 'Mandalay', age: 31,
    });
  });

  it('validates positive IDs and provides idempotent activate/deactivate operations', async () => {
    const active = repository();
    const activate = await request(app(active, ['member:update'])).post('/api/admin/v1/members/9/activate').set('Authorization', `Bearer ${token()}`);
    const deactivate = await request(app(active, ['member:update'])).post('/api/admin/v1/members/9/deactivate').set('Authorization', `Bearer ${token()}`);
    const invalid = await request(app(active, ['member:update'])).post('/api/admin/v1/members/0/activate').set('Authorization', `Bearer ${token()}`);

    expect(activate.body.data.changed).toBe(false);
    expect(deactivate.body.data.changed).toBe(true);
    expect(invalid.status).toBe(422);
  });
});
