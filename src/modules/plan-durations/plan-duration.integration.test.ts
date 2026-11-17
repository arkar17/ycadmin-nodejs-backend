import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['plan-duration:list', 'plan-duration:create', 'plan-duration:update', 'plan-duration:delete'];

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.');
};

const createIntegrationApp = () => createApp();

type Fixture = { activeAdminId: number; inactiveAdminId: number; roleId: number; permissionIds: Record<string, number>; referencedDurationId: number; unreferencedDurationId: number };

const resetAndSeed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "PlanDuration", "MemberType", "Permission", "Role", "User" RESTART IDENTITY CASCADE');

  const createdPermissions = await Promise.all(permissions.map((name) => prisma.permission.create({ data: { name, description: `Synthetic ${name} permission` } })));
  const permissionIds = Object.fromEntries(createdPermissions.map((permission) => [permission.name, permission.id]));
  const role = await prisma.role.create({ data: { name: 'Synthetic Duration Role', description: 'Synthetic isolated-test role' } });
  await prisma.rolePermission.createMany({ data: createdPermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const activeAdmin = await prisma.user.create({ data: { name: 'Synthetic Duration Admin', email: 'duration.admin@example.test', username: 'duration-admin', password: 'synthetic-password-hash' } });
  const inactiveAdmin = await prisma.user.create({ data: { name: 'Synthetic Inactive Duration Admin', email: 'duration.inactive@example.test', username: 'duration-inactive-admin', password: 'synthetic-password-hash', status: Status.INACTIVE } });
  await prisma.userRole.createMany({ data: [{ userId: activeAdmin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });

  const memberType = await prisma.memberType.create({ data: { name: 'Synthetic Duration Member Type' } });
  const referenced = await prisma.planDuration.create({ data: { name: 'One Month', value: 1, createdAt: new Date('2026-10-01T00:00:00.000Z') } });
  const unreferenced = await prisma.planDuration.create({ data: { name: 'Three Months', value: 3, createdAt: new Date('2026-10-02T00:00:00.000Z') } });
  await prisma.planDuration.create({ data: { name: 'Six Months', value: 6, createdAt: new Date('2026-10-03T00:00:00.000Z') } });
  await prisma.memberPlan.create({ data: { name: 'Synthetic Referencing Plan', memberTypeId: memberType.id, duration: 1, durationId: referenced.id } });
  await prisma.shopLevel.create({ data: { name: 'Synthetic Referencing Shop Level', duration: 1, durationId: referenced.id } });

  return { activeAdminId: activeAdmin.id, inactiveAdminId: inactiveAdmin.id, roleId: role.id, permissionIds, referencedDurationId: referenced.id, unreferencedDurationId: unreferenced.id };
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Plan Duration isolated PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await resetAndSeed(); });
  afterAll(async () => { await disconnectDatabase(); });

  it('lists/filter durations with deterministic pagination', async () => {
    const response = await request(createIntegrationApp()).get('/api/admin/v1/plan-durations?name=Month&limit=2&offset=1').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    expect(response.status).toBe(200);
    expect(response.body.data.map((duration: { name: string }) => duration.name)).toEqual(['Three Months', 'One Month']);
    expect(response.body.pagination).toEqual({ total: 3, limit: 2, offset: 1, currentPage: 1, totalPages: 2 });
  });

  it('creates and updates unreferenced durations while rejecting duplicate values', async () => {
    const app = createIntegrationApp();
    const created = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: 'Twelve Months', value: 12 });
    const duplicate = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: 'Duplicate', value: 3 });
    const updated = await request(app).patch(`/api/admin/v1/plan-durations/${fixture.unreferencedDurationId}`).set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: 'Four Months', value: 4 });

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(updated).toHaveProperty('status', 200);
    expect(updated.body.data).toMatchObject({ id: fixture.unreferencedDurationId, name: 'Four Months', value: 4 });
  });

  it('protects referenced durations and allows deleting an unreferenced duration', async () => {
    const app = createIntegrationApp();
    const updateReferenced = await request(app).patch(`/api/admin/v1/plan-durations/${fixture.referencedDurationId}`).set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: 'Changed' });
    const deleteReferenced = await request(app).delete(`/api/admin/v1/plan-durations/${fixture.referencedDurationId}`).set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    const deleteUnreferenced = await request(app).delete(`/api/admin/v1/plan-durations/${fixture.unreferencedDurationId}`).set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(updateReferenced.status).toBe(409);
    expect(deleteReferenced.status).toBe(409);
    expect(deleteReferenced.body.error.details).toEqual({ memberPlans: 1, shopLevels: 1 });
    expect(deleteUnreferenced.status).toBe(204);
  });

  it('rejects inactive/revoked Admins, malformed input, and missing records', async () => {
    const app = createIntegrationApp();
    const inactive = await request(app).get('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.permissionIds['plan-duration:create'] } });
    const revoked = await request(app).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: 'Blocked', value: 99 });

    fixture = await resetAndSeed();
    const malformed = await request(createIntegrationApp()).post('/api/admin/v1/plan-durations').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`).send({ name: '', value: 0 });
    const missing = await request(createIntegrationApp()).delete('/api/admin/v1/plan-durations/999').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(inactive.status).toBe(401);
    expect(revoked.status).toBe(403);
    expect(malformed.status).toBe(422);
    expect(missing.status).toBe(404);
  });
});
