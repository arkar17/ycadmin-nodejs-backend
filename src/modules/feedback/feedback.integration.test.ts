import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') {
    throw new Error('Integration tests may run only against the dedicated localhost integration database.');
  }
};

const createIntegrationApp = () => createApp();

type Fixture = { activeAdminId: number; inactiveAdminId: number; roleId: number; listPermissionId: number; readPermissionId: number };

const resetAndSeed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ClientFeedback", "RolePermission", "UserRole", "MemberProfile", "Member", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );

  const listPermission = await prisma.permission.create({ data: { name: 'feedback:list', description: 'Synthetic isolated-test feedback list permission' } });
  const readPermission = await prisma.permission.create({ data: { name: 'feedback:read', description: 'Synthetic isolated-test feedback read permission' } });
  const role = await prisma.role.create({ data: { name: 'Synthetic Feedback Role', description: 'Synthetic isolated-test role' } });
  await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: listPermission.id }, { roleId: role.id, permissionId: readPermission.id }] });

  const activeAdmin = await prisma.user.create({ data: { name: 'Synthetic Feedback Admin', email: 'feedback.admin@example.test', username: 'feedback-admin', password: 'synthetic-password-hash' } });
  const inactiveAdmin = await prisma.user.create({ data: { name: 'Synthetic Inactive Feedback Admin', email: 'feedback.inactive@example.test', username: 'feedback-inactive-admin', password: 'synthetic-password-hash', status: Status.INACTIVE } });
  await prisma.userRole.createMany({ data: [{ userId: activeAdmin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });

  const ada = await prisma.member.create({ data: { code: 'FB-001', name: 'Ada Feedback', email: 'ada.feedback@example.test', password: 'synthetic-member-password' } });
  const bryn = await prisma.member.create({ data: { code: 'FB-002', name: 'Bryn Feedback', email: 'bryn.feedback@example.test', password: 'synthetic-member-password' } });
  await prisma.clientFeedback.createMany({
    data: [
      { name: 'Yangon day start', memberId: ada.id, createdAt: new Date('2026-10-09T17:30:00.000Z') },
      { name: 'Yangon day latest', memberId: ada.id, createdAt: new Date('2026-10-10T17:29:59.999Z') },
      { name: 'Next Yangon day', memberId: bryn.id, createdAt: new Date('2026-10-10T17:30:00.000Z') },
    ],
  });

  return { activeAdminId: activeAdmin.id, inactiveAdminId: inactiveAdmin.id, roleId: role.id, listPermissionId: listPermission.id, readPermissionId: readPermission.id };
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Feedback isolated PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await resetAndSeed();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('filters by member name/client code and converts Asia/Yangon dates to UTC half-open ranges', async () => {
    const byDate = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback?date=2026-10-10')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    const byMember = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback?name=Ada&clientCode=FB-001')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(byDate.status).toBe(200);
    expect(byDate.body.data.map((item: { feedbackMessage: string }) => item.feedbackMessage)).toEqual(['Yangon day latest', 'Yangon day start']);
    expect(byMember.body.data).toHaveLength(2);
  });

  it('uses deterministic pagination and returns the safe detail DTO', async () => {
    const list = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback?limit=1&offset=1')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    const detail = await request(createIntegrationApp())
      .get(`/api/admin/v1/feedback/${list.body.data[0].id}`)
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(list.body.pagination).toEqual({ total: 3, limit: 1, offset: 1, currentPage: 2, totalPages: 3 });
    expect(detail.status).toBe(200);
    expect(detail.body.data.member).toEqual({ id: expect.any(Number), name: 'Ada Feedback', clientCode: 'FB-001' });
    expect(detail.body.data).not.toHaveProperty('updatedAt');
    expect(detail.body.data.member).not.toHaveProperty('email');
  });

  it('rejects inactive Admins, removed permissions, malformed input, and missing feedback', async () => {
    const inactive = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback')
      .set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.listPermissionId } });
    const revoked = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    fixture = await resetAndSeed();
    const feedback = await getPrismaClient().clientFeedback.findFirstOrThrow({ select: { id: true } });
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.readPermissionId } });
    const revokedDetail = await request(createIntegrationApp())
      .get(`/api/admin/v1/feedback/${feedback.id}`)
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    fixture = await resetAndSeed();
    const malformed = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback?date=2026-02-30')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    const missing = await request(createIntegrationApp())
      .get('/api/admin/v1/feedback/999')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(inactive.status).toBe(401);
    expect(revoked.status).toBe(403);
    expect(revokedDetail.status).toBe(403);
    expect(malformed.status).toBe(422);
    expect(missing.status).toBe(404);
  });
});
