import { randomUUID } from 'node:crypto';

import { Status } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createApp } from '../../app.js';
import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') {
    throw new Error('Integration tests may run only against the dedicated localhost integration database.');
  }
};

type Fixture = { adminId: number; inactiveAdminId: number; roleId: number; listPermissionId: number; durationId: number; shopLevelIds: number[]; userIds: number[]; createdPermissionIds: number[] };

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

const seed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  const suffix = randomUUID();
  const ensurePermission = async (name: string) => {
    const existing = await prisma.permission.findUnique({ where: { name } });
    return existing ? { permission: existing, created: false } : { permission: await prisma.permission.create({ data: { name, description: `Scoped ShopLevel test permission: ${name}` } }), created: true };
  };
  const [list, read] = await Promise.all([ensurePermission('shop-level:list'), ensurePermission('shop-level:read')]);
  const { permission: listPermission } = list;
  const { permission: readPermission } = read;
  const role = await prisma.role.create({ data: { name: `Scoped ShopLevel Role ${suffix}`, description: 'Scoped integration test role' } });
  await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: listPermission.id }, { roleId: role.id, permissionId: readPermission.id }] });
  const [admin, inactiveAdmin] = await Promise.all([
    prisma.user.create({ data: { name: 'Scoped ShopLevel Admin', email: `shop-level-admin-${suffix}@example.test`, username: `shop-level-admin-${suffix}`, password: 'synthetic-password-hash' } }),
    prisma.user.create({ data: { name: 'Scoped Inactive ShopLevel Admin', email: `shop-level-inactive-${suffix}@example.test`, username: `shop-level-inactive-${suffix}`, password: 'synthetic-password-hash', status: Status.INACTIVE } }),
  ]);
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });
  const duration = await prisma.planDuration.create({ data: { name: `Scoped ${suffix}`, value: 100_000_000 + Math.floor(Math.random() * 10_000_000) } });
  const older = await prisma.shopLevel.create({ data: { name: `Scoped Silver ${suffix}`, price: 5_000, duration: duration.value, durationId: duration.id, postLimit: 10, status: Status.ACTIVE, createdAt: new Date('2026-10-01T00:00:00.000Z') } });
  const newer = await prisma.shopLevel.create({ data: { name: `Scoped Gold ${suffix}`, price: 15_000, duration: duration.value, durationId: duration.id, postLimit: 20, status: Status.ACTIVE, createdAt: new Date('2026-10-02T00:00:00.000Z') } });
  return { adminId: admin.id, inactiveAdminId: inactiveAdmin.id, roleId: role.id, listPermissionId: listPermission.id, durationId: duration.id, shopLevelIds: [older.id, newer.id], userIds: [admin.id, inactiveAdmin.id], createdPermissionIds: [list, read].filter((entry) => entry.created).map((entry) => entry.permission.id) };
};

const cleanup = async (fixture: Fixture): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.shopLevel.deleteMany({ where: { id: { in: fixture.shopLevelIds } } });
  await prisma.planDuration.deleteMany({ where: { id: fixture.durationId } });
  await prisma.rolePermission.deleteMany({ where: { roleId: fixture.roleId } });
  await prisma.userRole.deleteMany({ where: { roleId: fixture.roleId } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await prisma.role.deleteMany({ where: { id: fixture.roleId } });
  if (fixture.createdPermissionIds.length > 0) {
    await prisma.permission.deleteMany({ where: { id: { in: fixture.createdPermissionIds } } });
  }
};

describe('Shop plan level scoped PostgreSQL integration', () => {
  let fixture: Fixture;

  beforeEach(async () => { fixture = await seed(); });
  afterEach(async () => { await cleanup(fixture); });
  afterAll(async () => { await disconnectDatabase(); });

  it('lists verified fields using filters, deterministic ordering, and bounded pagination', async () => {
    const response = await request(createApp())
      .get(`/api/admin/v1/shop-plan-levels?name=Scoped&status=ACTIVE&durationId=${fixture.durationId}&limit=1&offset=0`)
      .set('Authorization', `Bearer ${token(fixture.adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: fixture.shopLevelIds[1], name: expect.stringContaining('Scoped Gold'), price: 15000, postLimit: 20, status: 'ACTIVE', planDuration: { id: fixture.durationId } });
    expect(response.body.data[0]).not.toHaveProperty('image');
    expect(response.body.data[0]).not.toHaveProperty('description');
    expect(response.body.pagination).toEqual({ total: 2, limit: 1, offset: 0, currentPage: 1, totalPages: 2 });
  });

  it('returns safe detail and rejects inactive or permission-revoked Admins', async () => {
    const app = createApp();
    const detail = await request(app).get(`/api/admin/v1/shop-plan-levels/${fixture.shopLevelIds[0]}`).set('Authorization', `Bearer ${token(fixture.adminId)}`);
    const inactive = await request(app).get('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.listPermissionId } });
    const revoked = await request(app).get('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data).not.toHaveProperty('image');
    expect(inactive.status).toBe(401);
    expect(revoked.status).toBe(403);
  });
});
