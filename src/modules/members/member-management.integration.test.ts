import { MemberRequestStatus, Status } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const integrationDatabaseName = '/yc_fitness_admin_integration';
const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== integrationDatabaseName) {
    throw new Error('Integration tests may run only against the dedicated localhost integration database.');
  }
};

type Fixture = {
  adminId: number;
  noPermissionAdminId: number;
  memberId: number;
  otherMemberId: number;
  requestId: number;
  shopId: number;
  attendanceId: number;
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (id: number) => ({ Authorization: `Bearer ${token(id)}` });

const reset = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_member_profile_update ON "MemberProfile"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_member_profile_update()');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Attendance", "Shop", "MemberRequest", "MemberProfile", "MemberPlan", "MemberType", "ShopLevel", "RolePermission", "UserRole", "Member", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );

  const permissions = await Promise.all(['member:list', 'member:read', 'member:update'].map((name) =>
    prisma.permission.create({ data: { name, description: 'Synthetic member-management permission' } }),
  ));
  const role = await prisma.role.create({ data: { name: 'Synthetic Member Manager' } });
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const admin = await prisma.user.create({
    data: { name: 'Member Manager', email: 'member.manager@example.test', username: 'member-manager', password: 'hash' },
  });
  await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
  const emptyRole = await prisma.role.create({ data: { name: 'Synthetic Empty Member Role' } });
  const noPermission = await prisma.user.create({
    data: { name: 'No Member Permission', email: 'no.member.permission@example.test', username: 'no-member-permission', password: 'hash' },
  });
  await prisma.userRole.create({ data: { userId: noPermission.id, roleId: emptyRole.id } });

  const memberType = await prisma.memberType.create({ data: { name: 'Synthetic Trainer Type' } });
  const memberPlan = await prisma.memberPlan.create({
    data: { name: 'Synthetic Trainer Plan', memberTypeId: memberType.id, price: 250, duration: 12 },
  });
  const member = await prisma.member.create({
    data: {
      name: 'Managed Member',
      code: 'MANAGED-001',
      email: 'managed.member@example.test',
      phone: '09111111111',
      countryCode: '+95',
      password: 'private-password-hash',
      clientType: 'trainer',
      memberTypeId: memberType.id,
      createdById: admin.id,
      profile: {
        create: {
          address: 'Yangon',
          bio: 'Trainer biography',
          gender: 'FEMALE',
          age: 29,
          yearOfExp: 7,
          reason: 'Safe coaching',
          profilePhoto: 'https://private.invalid/profile.jpg',
          profilePhotoKey: 'private/profile-key',
          certificates: [{ url: 'https://private.invalid/certificate.pdf' }],
          photos: [{ url: 'https://private.invalid/trainer.jpg' }],
        },
      },
    },
  });
  const other = await prisma.member.create({
    data: {
      name: 'Other Member', code: 'MANAGED-002', email: 'other.member@example.test', phone: '09222222222', password: 'hash',
    },
  });
  const memberRequest = await prisma.memberRequest.create({
    data: {
      memberId: member.id,
      memberTypeId: memberType.id,
      memberPlanId: memberPlan.id,
      status: MemberRequestStatus.APPROVED,
      approvedById: admin.id,
      approvedAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  });
  const shopLevel = await prisma.shopLevel.create({ data: { name: 'Synthetic Gold', price: 10, duration: 1 } });
  const shop = await prisma.shop.create({
    data: { name: 'Managed Shop', logo: 'https://private.invalid/logo.png', memberId: member.id, shopLevelId: shopLevel.id },
  });
  const createAttendanceAt = (instant: string) => prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL "yc.attendance_test_clock" = '${instant}'`);
    return transaction.attendance.create({ data: { memberId: member.id } });
  });
  const attendance = await createAttendanceAt('2026-10-02T03:00:00.000Z');
  await createAttendanceAt('2026-10-03T03:00:00.000Z');

  return {
    adminId: admin.id,
    noPermissionAdminId: noPermission.id,
    memberId: member.id,
    otherMemberId: other.id,
    requestId: memberRequest.id,
    shopId: shop.id,
    attendanceId: attendance.id,
  };
};

describe('Member management isolated PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await reset();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('returns the schema-backed safe detail and enforces member:read', async () => {
    const forbidden = await request(createApp()).get(`/api/admin/v1/members/${fixture.memberId}`).set(auth(fixture.noPermissionAdminId));
    const response = await request(createApp()).get(`/api/admin/v1/members/${fixture.memberId}`).set(auth(fixture.adminId));
    const missing = await request(createApp()).get('/api/admin/v1/members/999999').set(auth(fixture.adminId));

    expect(forbidden.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: fixture.memberId,
      clientType: 'trainer',
      memberType: { name: 'Synthetic Trainer Type' },
      profile: { yearOfExp: 7, reason: 'Safe coaching', hasProfilePhoto: true, hasCertificates: true, hasPhotos: true },
      latestMemberRequest: {
        id: fixture.requestId,
        status: 'APPROVED',
        requestedMemberPlan: { name: 'Synthetic Trainer Plan', durationMonths: 12 },
      },
      shop: { id: fixture.shopId, name: 'Managed Shop', hasLogo: true, level: { name: 'Synthetic Gold' } },
      attendance: { total: 2, lastCheckedInAt: '2026-10-03T03:00:00.000Z' },
      createdBy: { id: fixture.adminId, name: 'Member Manager' },
    });
    const serialized = JSON.stringify(response.body);
    for (const secret of ['private-password-hash', 'private.invalid', 'profilePhotoKey', 'certificates', 'photos', 'logo']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('updates Member and MemberProfile atomically and records the current Admin audit identity', async () => {
    const response = await request(createApp())
      .patch(`/api/admin/v1/members/${fixture.memberId}`)
      .set(auth(fixture.adminId))
      .send({ name: 'Updated Member', email: 'UPDATED@EXAMPLE.TEST', phone: '09333333333', address: 'Mandalay', age: 30 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ changed: true, member: { name: 'Updated Member', email: 'updated@example.test', phone: '09333333333' } });
    const stored = await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.memberId }, include: { profile: true } });
    expect(stored).toMatchObject({ name: 'Updated Member', email: 'updated@example.test', updatedById: fixture.adminId });
    expect(stored.profile).toMatchObject({ address: 'Mandalay', age: 30, yearOfExp: 7, reason: 'Safe coaching' });
  });

  it('rejects unsupported fields and maps unique identity conflicts without leaking Prisma errors', async () => {
    const unsupported = await request(createApp())
      .patch(`/api/admin/v1/members/${fixture.memberId}`).set(auth(fixture.adminId)).send({ memberTypeId: 999 });
    const conflict = await request(createApp())
      .patch(`/api/admin/v1/members/${fixture.memberId}`).set(auth(fixture.adminId)).send({ email: 'other.member@example.test' });

    expect(unsupported.status).toBe(422);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: 'MEMBER_IDENTITY_CONFLICT', details: { field: 'email' } });
    expect(JSON.stringify(conflict.body)).not.toContain('P2002');
  });

  it('rolls back the Member update when the profile write fails', async () => {
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_member_profile_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic profile failure'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_member_profile_update BEFORE UPDATE ON "MemberProfile" FOR EACH ROW EXECUTE FUNCTION fail_member_profile_update()`);

    const response = await request(createApp())
      .patch(`/api/admin/v1/members/${fixture.memberId}`).set(auth(fixture.adminId))
      .send({ name: 'Must Roll Back', address: 'Must Roll Back' });
    const stored = await prisma.member.findUniqueOrThrow({ where: { id: fixture.memberId }, include: { profile: true } });

    expect(response.status).toBe(500);
    expect(stored.name).toBe('Managed Member');
    expect(stored.profile?.address).toBe('Yangon');
  });

  it('activates and deactivates idempotently without mutating related business records', async () => {
    const value = createApp();
    const activeReplay = await request(value).post(`/api/admin/v1/members/${fixture.memberId}/activate`).set(auth(fixture.adminId));
    const deactivate = await request(value).post(`/api/admin/v1/members/${fixture.memberId}/deactivate`).set(auth(fixture.adminId));
    const inactiveReplay = await request(value).post(`/api/admin/v1/members/${fixture.memberId}/deactivate`).set(auth(fixture.adminId));
    const activate = await request(value).post(`/api/admin/v1/members/${fixture.memberId}/activate`).set(auth(fixture.adminId));

    expect([activeReplay.body.data.changed, deactivate.body.data.changed, inactiveReplay.body.data.changed, activate.body.data.changed])
      .toEqual([false, true, false, true]);
    expect((await getPrismaClient().member.findUniqueOrThrow({ where: { id: fixture.memberId } })).status).toBe(Status.ACTIVE);
    expect(await getPrismaClient().memberRequest.count({ where: { id: fixture.requestId, status: MemberRequestStatus.APPROVED } })).toBe(1);
    expect(await getPrismaClient().shop.count({ where: { id: fixture.shopId, status: Status.ACTIVE } })).toBe(1);
    expect(await getPrismaClient().attendance.count({ where: { memberId: fixture.memberId } })).toBe(2);
  });
});
