import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { MemberRequestStatus, Status } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): string => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') {
    throw new Error('Integration tests may run only against the dedicated localhost integration database.');
  }
  return databaseUrl.toString();
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });
const countAt = (response: request.Response, bucket: string, field: 'registrations' | 'attendance' | 'membershipRequests') =>
  Number(response.body.data.trends.points.find((point: { bucket: string }) => point.bucket === bucket)?.[field] ?? 0);

type Fixture = {
  adminId: number; inactiveAdminId: number; roleId: number; permissionId: number; createdPermissionIds: number[];
  memberIds: number[]; requestIds: number[]; attendanceIds: number[]; planId: number; typeId: number; durationId: number; userIds: number[];
};

const ensurePermission = async (name: string) => {
  const prisma = getPrismaClient();
  const existing = await prisma.permission.findUnique({ where: { name } });
  return existing ? { permission: existing, created: false } : { permission: await prisma.permission.create({ data: { name, description: `Scoped dashboard test permission: ${name}` } }), created: true };
};

const insertAttendanceAt = async (memberId: number, timestamp: string): Promise<number> => {
  const connection = new Client({ connectionString: assertIsolatedDatabase() });
  await connection.connect();
  try {
    await connection.query("SELECT set_config('yc.attendance_test_clock', $1, false)", [timestamp]);
    const result = await connection.query('INSERT INTO "Attendance" ("memberId", "date", "source") VALUES ($1, $2, $3) RETURNING "id"', [memberId, 'ignored-by-trigger', 'LEGACY']);
    return Number(result.rows[0].id);
  } finally {
    await connection.end();
  }
};

const seed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  const suffix = randomUUID();
  const permissionState = await ensurePermission('dashboard:read');
  const role = await prisma.role.create({ data: { name: `Scoped Dashboard Role ${suffix}`, description: 'Scoped dashboard integration role' } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permissionState.permission.id } });
  const [admin, inactiveAdmin] = await Promise.all([
    prisma.user.create({ data: { name: 'Scoped Dashboard Admin', email: `dashboard-admin-${suffix}@example.test`, username: `dashboard-admin-${suffix}`, password: 'synthetic-password-hash' } }),
    prisma.user.create({ data: { name: 'Scoped Inactive Dashboard Admin', email: `dashboard-inactive-${suffix}@example.test`, username: `dashboard-inactive-${suffix}`, password: 'synthetic-password-hash', status: Status.INACTIVE } }),
  ]);
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });
  const duration = await prisma.planDuration.create({ data: { name: `Scoped Dashboard ${suffix}`, value: 200_000_000 + Math.floor(Math.random() * 10_000_000) } });
  const type = await prisma.memberType.create({ data: { name: `Scoped Dashboard Type ${suffix}` } });
  const plan = await prisma.memberPlan.create({ data: { name: `Scoped Dashboard Plan ${suffix}`, memberTypeId: type.id, durationId: duration.id, duration: duration.value } });
  const createMember = (name: string, createdAt: Date, status = Status.ACTIVE) => prisma.member.create({ data: { name, code: `DASH-${randomUUID()}`, password: 'synthetic-member-password', status, createdAt } });
  const [before, first, second, inactive, after] = await Promise.all([
    createMember('Dashboard before boundary', new Date('2099-01-31T17:29:59.999Z')),
    createMember('Dashboard first included', new Date('2099-01-31T17:30:00.000Z')),
    createMember('Dashboard second included', new Date('2099-02-15T12:00:00.000Z')),
    createMember('Dashboard inactive included', new Date('2099-02-28T17:29:59.999Z'), Status.INACTIVE),
    createMember('Dashboard after boundary', new Date('2099-02-28T17:30:00.000Z')),
  ]);
  const [pending, approved, rejected] = await Promise.all([
    prisma.memberRequest.create({ data: { memberId: first.id, memberTypeId: type.id, memberPlanId: plan.id, status: MemberRequestStatus.PENDING, createdAt: new Date('2099-01-31T17:30:00.000Z') } }),
    prisma.memberRequest.create({ data: { memberId: second.id, memberTypeId: type.id, memberPlanId: plan.id, status: MemberRequestStatus.APPROVED, createdAt: new Date('2099-02-15T12:00:00.000Z') } }),
    prisma.memberRequest.create({ data: { memberId: inactive.id, memberTypeId: type.id, memberPlanId: plan.id, status: MemberRequestStatus.REJECTED, createdAt: new Date('2099-02-28T17:29:59.999Z') } }),
  ]);
  const attendanceIds = [
    await insertAttendanceAt(before.id, '2099-01-31T17:29:59.999Z'),
    await insertAttendanceAt(first.id, '2099-01-31T17:30:00.000Z'),
    await insertAttendanceAt(first.id, '2099-01-31T19:00:00.000Z'),
    await insertAttendanceAt(second.id, '2099-02-28T17:29:59.999Z'),
    await insertAttendanceAt(after.id, '2099-02-28T17:30:00.000Z'),
  ];
  return {
    adminId: admin.id, inactiveAdminId: inactiveAdmin.id, roleId: role.id, permissionId: permissionState.permission.id,
    createdPermissionIds: permissionState.created ? [permissionState.permission.id] : [], memberIds: [before.id, first.id, second.id, inactive.id, after.id], requestIds: [pending.id, approved.id, rejected.id], attendanceIds, planId: plan.id, typeId: type.id, durationId: duration.id, userIds: [admin.id, inactiveAdmin.id],
  };
};

const cleanup = async (fixture: Fixture): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.attendance.deleteMany({ where: { id: { in: fixture.attendanceIds } } });
  await prisma.memberRequest.deleteMany({ where: { id: { in: fixture.requestIds } } });
  await prisma.member.deleteMany({ where: { id: { in: fixture.memberIds } } });
  await prisma.memberPlan.deleteMany({ where: { id: fixture.planId } });
  await prisma.memberType.deleteMany({ where: { id: fixture.typeId } });
  await prisma.planDuration.deleteMany({ where: { id: fixture.durationId } });
  await prisma.rolePermission.deleteMany({ where: { roleId: fixture.roleId } });
  await prisma.userRole.deleteMany({ where: { roleId: fixture.roleId } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await prisma.role.deleteMany({ where: { id: fixture.roleId } });
  if (fixture.createdPermissionIds.length > 0) await prisma.permission.deleteMany({ where: { id: { in: fixture.createdPermissionIds } } });
};

describe('Dashboard overview scoped PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await seed(); });
  afterEach(async () => { await cleanup(fixture); });
  afterAll(async () => { await disconnectDatabase(); });

  it('uses Yangon half-open month boundaries for selected-period aggregates and zero-filled trends', async () => {
    const app = createApp();
    const response = await request(app).get('/api/admin/v1/dashboard/overview?month=2099-02').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    expect(response.status).toBe(200);
    expect(response.body.data.members.newRegistered).toBe(3);
    expect(response.body.data.attendance.totalRecords).toBe(3);
    expect(response.body.data.attendance.distinctMembers).toBe(2);
    expect(response.body.data.membershipRequests.newSubmitted).toBe(3);
    expect(response.body.data.membershipRequests.currentStatus.pending).toBeGreaterThanOrEqual(1);
    expect(response.body.data.membershipRequests.currentStatus.approved).toBeGreaterThanOrEqual(1);
    expect(response.body.data.membershipRequests.currentStatus.rejected).toBeGreaterThanOrEqual(1);
    expect(countAt(response, '2099-02-01', 'registrations')).toBe(1);
    expect(countAt(response, '2099-02-01', 'attendance')).toBe(2);
    expect(countAt(response, '2099-02-28', 'attendance')).toBe(1);
    expect(response.body.data.trends.points).toHaveLength(28);
  });

  it('enforces active Admin and dashboard:read from the database', async () => {
    const app = createApp();
    const inactive = await request(app).get('/api/admin/v1/dashboard/overview?month=2099-02').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.permissionId } });
    const revoked = await request(app).get('/api/admin/v1/dashboard/overview?month=2099-02').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    expect(inactive.status).toBe(401);
    expect(revoked.status).toBe(403);
  });
});
