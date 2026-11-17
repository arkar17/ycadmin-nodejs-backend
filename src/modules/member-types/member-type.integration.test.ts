import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Status } from '@prisma/client';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.');
};

const createIntegrationApp = () => createApp();

type Fixture = { activeAdminId: number; inactiveAdminId: number; roleId: number; permissionId: number };

const resetAndSeed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "MemberType", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
  const permission = await prisma.permission.create({ data: { name: 'member-type:list', description: 'Synthetic isolated-test member type list permission' } });
  const role = await prisma.role.create({ data: { name: 'Synthetic Member Type Role', description: 'Synthetic isolated-test role' } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  const activeAdmin = await prisma.user.create({ data: { name: 'Synthetic Member Type Admin', email: 'member-type.admin@example.test', username: 'member-type-admin', password: 'synthetic-password-hash' } });
  const inactiveAdmin = await prisma.user.create({ data: { name: 'Synthetic Inactive Member Type Admin', email: 'member-type.inactive@example.test', username: 'member-type-inactive-admin', password: 'synthetic-password-hash', status: Status.INACTIVE } });
  await prisma.userRole.createMany({ data: [{ userId: activeAdmin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });
  await prisma.memberType.create({ data: { name: 'Gym Member', status: Status.ACTIVE, createdAt: new Date('2026-10-01T00:00:00.000Z') } });
  await prisma.memberType.create({ data: { name: 'Trainer Member', status: Status.ACTIVE, createdAt: new Date('2026-10-02T00:00:00.000Z') } });
  await prisma.memberType.create({ data: { name: 'Legacy Member', status: Status.INACTIVE, createdAt: new Date('2026-10-03T00:00:00.000Z') } });
  return { activeAdminId: activeAdmin.id, inactiveAdminId: inactiveAdmin.id, roleId: role.id, permissionId: permission.id };
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

describe('Member Type isolated PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await resetAndSeed(); });
  afterAll(async () => { await disconnectDatabase(); });

  it('filters by verified fields and uses createdAt/id descending pagination', async () => {
    const response = await request(createIntegrationApp())
      .get('/api/admin/v1/member-types?name=Member&status=ACTIVE&limit=1&offset=0')
      .set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 2, name: 'Trainer Member', status: 'ACTIVE' }]);
    expect(response.body.pagination).toEqual({ total: 2, limit: 1, offset: 0, currentPage: 1, totalPages: 2 });
  });

  it('rejects inactive and permission-revoked Admins, plus malformed status filters', async () => {
    const inactive = await request(createIntegrationApp()).get('/api/admin/v1/member-types').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.permissionId } });
    const revoked = await request(createIntegrationApp()).get('/api/admin/v1/member-types').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);

    fixture = await resetAndSeed();
    const malformed = await request(createIntegrationApp()).get('/api/admin/v1/member-types?status=UNKNOWN').set('Authorization', `Bearer ${token(fixture.activeAdminId)}`);
    expect(inactive.status).toBe(401);
    expect(revoked.status).toBe(403);
    expect(malformed.status).toBe(422);
  });
});
