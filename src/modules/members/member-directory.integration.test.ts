import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const integrationDatabaseName = '/yc_fitness_admin_integration';
const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
    databaseUrl.pathname !== integrationDatabaseName
  ) {
    throw new Error('Integration tests may run only against the dedicated localhost integration database.');
  }
};

const createIntegrationApp = () => createApp();

type Fixture = {
  activeAdminId: number;
  noPermissionAdminId: number;
  inactiveAdminId: number;
  roleId: number;
  permissionId: number;
};

const resetAndSeed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();

  // The URL assertion above limits this destructive reset to the dedicated test database.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RolePermission", "UserRole", "MemberProfile", "Member", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );

  const permission = await prisma.permission.create({
    data: { name: 'member:list', description: 'Synthetic integration-test permission' },
  });
  const role = await prisma.role.create({
    data: { name: 'Synthetic Directory Role', description: 'Synthetic integration-test role' },
  });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

  const activeAdmin = await prisma.user.create({
    data: {
      name: 'Synthetic Active Admin',
      email: 'synthetic.active.admin@example.test',
      username: 'synthetic-active-admin',
      password: 'synthetic-only-password-hash',
    },
  });
  await prisma.userRole.create({ data: { userId: activeAdmin.id, roleId: role.id } });

  const noPermissionAdmin = await prisma.user.create({
    data: {
      name: 'Synthetic No Permission Admin',
      email: 'synthetic.no-permission.admin@example.test',
      username: 'synthetic-no-permission-admin',
      password: 'synthetic-only-password-hash',
    },
  });

  const inactiveAdmin = await prisma.user.create({
    data: {
      name: 'Synthetic Inactive Admin',
      email: 'synthetic.inactive.admin@example.test',
      username: 'synthetic-inactive-admin',
      password: 'synthetic-only-password-hash',
      status: Status.INACTIVE,
    },
  });
  await prisma.userRole.create({ data: { userId: inactiveAdmin.id, roleId: role.id } });

  await prisma.member.create({
    data: {
      code: 'SYN-001',
      name: 'Ada Search',
      email: 'ada.synthetic@example.test',
      phone: '+959111000001',
      password: 'synthetic-member-password-hash',
      clientType: 'gym_member',
      createdAt: new Date('2026-10-03T10:00:00.000Z'),
      profile: {
        create: {
          gender: 'FEMALE',
          address: 'Synthetic Address One',
          profilePhoto: 'https://example.invalid/private-profile.jpg',
          profilePhotoKey: 'private/synthetic-profile-key',
        },
      },
    },
  });
  await prisma.member.create({
    data: {
      code: 'SYN-002',
      name: 'Ada Profileless',
      email: 'profileless.synthetic@example.test',
      phone: '+959111000002',
      password: 'synthetic-member-password-hash',
      clientType: 'user',
      createdAt: new Date('2026-10-02T10:00:00.000Z'),
    },
  });
  await prisma.member.create({
    data: {
      code: 'SYN-003',
      name: 'Bryn Contact',
      email: 'bryn.contact@example.test',
      phone: '+959111000003',
      password: 'synthetic-member-password-hash',
      clientType: 'trainer',
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      profile: { create: { gender: 'MALE', address: 'Synthetic Address Three' } },
    },
  });

  return {
    activeAdminId: activeAdmin.id,
    noPermissionAdminId: noPermissionAdmin.id,
    inactiveAdminId: inactiveAdmin.id,
    roleId: role.id,
    permissionId: permission.id,
  };
};

const adminToken = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Member Directory isolated PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await resetAndSeed();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('authorizes an active Admin and filters name plus phone/email using Prisma', async () => {
    const response = await request(createIntegrationApp())
      .get('/api/admin/v1/members?name=Ada&contact=ada.synthetic%40example.test')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ clientCode: 'SYN-001', name: 'Ada Search' });
  });

  it('uses createdAt/id descending ordering, offset pagination, and nullable profiles', async () => {
    const firstPage = await request(createIntegrationApp())
      .get('/api/admin/v1/members?limit=2&offset=0')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);
    const secondPage = await request(createIntegrationApp())
      .get('/api/admin/v1/members?limit=2&offset=2')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.map((member: { clientCode: string }) => member.clientCode)).toEqual(['SYN-001', 'SYN-002']);
    expect(firstPage.body.data[1]).toMatchObject({ gender: null, address: null, memberPlan: null });
    expect(firstPage.body.pagination).toEqual({ total: 3, limit: 2, offset: 0, currentPage: 1, totalPages: 2 });
    expect(secondPage.body.data.map((member: { clientCode: string }) => member.clientCode)).toEqual(['SYN-003']);
  });

  it('excludes password and stored-media fields from database-backed DTOs', async () => {
    const response = await request(createIntegrationApp())
      .get('/api/admin/v1/members?name=Ada%20Search')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0]).not.toHaveProperty('password');
    expect(response.body.data[0]).not.toHaveProperty('profilePhoto');
    expect(response.body.data[0]).not.toHaveProperty('profilePhotoKey');
    expect(response.body.data[0]).not.toHaveProperty('attendanceSubjectId');
  });

  it('rejects inactive Admins and active Admins without a current member:list permission', async () => {
    const inactiveResponse = await request(createIntegrationApp())
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken(fixture.inactiveAdminId)}`);
    const noPermissionResponse = await request(createIntegrationApp())
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken(fixture.noPermissionAdminId)}`);

    expect(inactiveResponse.status).toBe(401);
    expect(noPermissionResponse.status).toBe(403);
  });

  it('uses current RBAC assignments and rejects memberPlanId filtering', async () => {
    const prisma = getPrismaClient();
    await prisma.rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.permissionId } });

    const revokedResponse = await request(createIntegrationApp())
      .get('/api/admin/v1/members')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);
    const memberPlanResponse = await request(createIntegrationApp())
      .get('/api/admin/v1/members?memberPlanId=123')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);

    expect(revokedResponse.status).toBe(403);
    // Use a separate fresh fixture so validation is reached by an authorized Admin.
    fixture = await resetAndSeed();
    const authorizedMemberPlanResponse = await request(createIntegrationApp())
      .get('/api/admin/v1/members?memberPlanId=123')
      .set('Authorization', `Bearer ${adminToken(fixture.activeAdminId)}`);
    expect(memberPlanResponse.status).toBe(403);
    expect(authorizedMemberPlanResponse.status).toBe(422);
    expect(authorizedMemberPlanResponse.body.error.details[0].message).toContain('Member-plan filtering is unavailable');
  });
});
