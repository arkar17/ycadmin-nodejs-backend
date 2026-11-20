import { randomUUID } from 'node:crypto';

import { PaymentRequestType, Status } from '@prisma/client';
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

type Fixture = {
  adminId: number;
  inactiveAdminId: number;
  roleId: number;
  listPermissionId: number;
  durationIds: number[];
  shopLevelIds: number[];
  userIds: number[];
  createdPermissionIds: number[];
  memberIds: number[];
  shopIds: number[];
  requestIds: number[];
  paymentIds: number[];
  bankIds: number[];
};

const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });

const seed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  const suffix = randomUUID();
  const ensurePermission = async (name: string) => {
    const existing = await prisma.permission.findUnique({ where: { name } });
    return existing ? { permission: existing, created: false } : { permission: await prisma.permission.create({ data: { name, description: `Scoped ShopLevel test permission: ${name}` } }), created: true };
  };
  const permissionStates = await Promise.all(['list', 'read', 'create', 'update', 'delete'].map((action) => ensurePermission(`shop-level:${action}`)));
  const [list, read] = permissionStates;
  const { permission: listPermission } = list;
  const { permission: readPermission } = read;
  const role = await prisma.role.create({ data: { name: `Scoped ShopLevel Role ${suffix}`, description: 'Scoped integration test role' } });
  await prisma.rolePermission.createMany({ data: permissionStates.map(({ permission }) => ({ roleId: role.id, permissionId: permission.id })) });
  const [admin, inactiveAdmin] = await Promise.all([
    prisma.user.create({ data: { name: 'Scoped ShopLevel Admin', email: `shop-level-admin-${suffix}@example.test`, username: `shop-level-admin-${suffix}`, password: 'synthetic-password-hash' } }),
    prisma.user.create({ data: { name: 'Scoped Inactive ShopLevel Admin', email: `shop-level-inactive-${suffix}@example.test`, username: `shop-level-inactive-${suffix}`, password: 'synthetic-password-hash', status: Status.INACTIVE } }),
  ]);
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: inactiveAdmin.id, roleId: role.id }] });
  const duration = await prisma.planDuration.create({ data: { name: `Scoped ${suffix}`, value: 100_000_000 + Math.floor(Math.random() * 10_000_000) } });
  const replacementDuration = await prisma.planDuration.create({ data: { name: `Scoped replacement ${suffix}`, value: duration.value + 1 } });
  const older = await prisma.shopLevel.create({ data: { name: `Scoped Silver ${suffix}`, price: 5_000, duration: duration.value, durationId: duration.id, postLimit: 10, status: Status.ACTIVE, createdAt: new Date('2026-10-01T00:00:00.000Z') } });
  const newer = await prisma.shopLevel.create({ data: { name: `Scoped Gold ${suffix}`, price: 15_000, duration: duration.value, durationId: duration.id, postLimit: 20, status: Status.ACTIVE, createdAt: new Date('2026-10-02T00:00:00.000Z') } });
  return {
    adminId: admin.id,
    inactiveAdminId: inactiveAdmin.id,
    roleId: role.id,
    listPermissionId: listPermission.id,
    durationIds: [duration.id, replacementDuration.id],
    shopLevelIds: [older.id, newer.id],
    userIds: [admin.id, inactiveAdmin.id],
    createdPermissionIds: permissionStates.filter((entry) => entry.created).map((entry) => entry.permission.id),
    memberIds: [],
    shopIds: [],
    requestIds: [],
    paymentIds: [],
    bankIds: [],
  };
};

const cleanup = async (fixture: Fixture): Promise<void> => {
  const prisma = getPrismaClient();
  await prisma.payment.deleteMany({ where: { id: { in: fixture.paymentIds } } });
  await prisma.shopUpgradeRequest.deleteMany({ where: { id: { in: fixture.requestIds } } });
  await prisma.shop.deleteMany({ where: { id: { in: fixture.shopIds } } });
  await prisma.bankInformation.deleteMany({ where: { id: { in: fixture.bankIds } } });
  await prisma.member.deleteMany({ where: { id: { in: fixture.memberIds } } });
  await prisma.shopLevel.deleteMany({ where: { id: { in: fixture.shopLevelIds } } });
  await prisma.planDuration.deleteMany({ where: { id: { in: fixture.durationIds } } });
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
  afterEach(async () => { if (fixture !== undefined) await cleanup(fixture); });
  afterAll(async () => { await disconnectDatabase(); });

  it('lists verified fields using filters, deterministic ordering, and bounded pagination', async () => {
    const response = await request(createApp())
      .get(`/api/admin/v1/shop-plan-levels?name=Scoped&status=ACTIVE&durationId=${fixture.durationIds[0]}&limit=1&offset=0`)
      .set('Authorization', `Bearer ${token(fixture.adminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ id: fixture.shopLevelIds[1], name: expect.stringContaining('Scoped Gold'), price: 15000, postLimit: 20, status: 'ACTIVE', planDuration: { id: fixture.durationIds[0] } });
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

  it('creates canonical data with audit ownership and rejects invalid references, duplicate names, numeric errors, and unsafe fields', async () => {
    const app = createApp();
    const duration = await getPrismaClient().planDuration.findUniqueOrThrow({ where: { id: fixture.durationIds[0] } });
    const created = await request(app).post('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({
      name: '  Scoped Platinum  ', price: 25_000, durationId: duration.id, description: '  Premium level  ', postLimit: 30,
    });
    fixture.shopLevelIds.push(created.body.data.id);
    const stored = await getPrismaClient().shopLevel.findUniqueOrThrow({ where: { id: created.body.data.id } });
    const invalidDuration = await request(app).post('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Invalid Duration', price: 0, durationId: 999_999_999, postLimit: 0 });
    const duplicate = await request(app).post('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Scoped Platinum', price: 0, durationId: duration.id, postLimit: 0 });
    const badNumbers = await request(app).post('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Bad Numbers', price: -1, durationId: duration.id, postLimit: 1.5 });
    const unsafe = await request(app).post('/api/admin/v1/shop-plan-levels').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Unsafe', price: 0, durationId: duration.id, postLimit: 1, image: '/private.png', createdById: fixture.inactiveAdminId, updatedById: fixture.inactiveAdminId });

    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty('image');
    expect(stored).toMatchObject({ name: 'Scoped Platinum', price: 25_000, durationId: duration.id, duration: duration.value, description: 'Premium level', postLimit: 30, status: Status.ACTIVE, createdById: fixture.adminId });
    expect(invalidDuration.body.error).toMatchObject({ code: 'INVALID_REFERENCE', details: { field: 'durationId' } });
    expect(duplicate.body.error.code).toBe('SHOP_LEVEL_NAME_CONFLICT');
    expect([invalidDuration.status, duplicate.status, badNumbers.status, unsafe.status]).toEqual([422, 409, 422, 422]);
  });

  it('partially updates canonical fields, synchronizes duration, records the actor, and does not cascade post limits', async () => {
    const prisma = getPrismaClient();
    const levelId = fixture.shopLevelIds[0];
    const member = await prisma.member.create({ data: { name: 'Scoped Shop Owner', code: `SHOP-${randomUUID()}`, password: 'hash' } });
    fixture.memberIds.push(member.id);
    const shop = await prisma.shop.create({ data: { name: 'Scoped Existing Shop', memberId: member.id, shopLevelId: levelId } });
    fixture.shopIds.push(shop.id);
    const upgradeRequest = await prisma.shopUpgradeRequest.create({ data: { memberId: member.id, shopLevelId: levelId, postCount: 7 } });
    fixture.requestIds.push(upgradeRequest.id);

    const response = await request(createApp()).patch(`/api/admin/v1/shop-plan-levels/${levelId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`).send({
      durationId: fixture.durationIds[1], postLimit: 44, description: null, status: 'INACTIVE',
    });
    const [stored, unchangedShop, unchangedRequest] = await Promise.all([
      prisma.shopLevel.findUniqueOrThrow({ where: { id: levelId } }),
      prisma.shop.findUniqueOrThrow({ where: { id: shop.id } }),
      prisma.shopUpgradeRequest.findUniqueOrThrow({ where: { id: upgradeRequest.id } }),
    ]);
    const replacementDuration = await prisma.planDuration.findUniqueOrThrow({ where: { id: fixture.durationIds[1] } });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: levelId, duration: replacementDuration.value, postLimit: 44, status: 'INACTIVE' });
    expect(stored).toMatchObject({ durationId: replacementDuration.id, duration: replacementDuration.value, postLimit: 44, description: null, status: Status.INACTIVE, updatedById: fixture.adminId });
    expect(unchangedShop).toMatchObject({ id: shop.id, shopLevelId: levelId });
    expect(unchangedRequest).toMatchObject({ id: upgradeRequest.id, shopLevelId: levelId, postCount: 7 });
  });

  it('maps duplicate-name and invalid-duration updates without changing the record', async () => {
    const app = createApp();
    const targetId = fixture.shopLevelIds[0];
    const original = await getPrismaClient().shopLevel.findUniqueOrThrow({ where: { id: targetId } });
    const duplicateName = await getPrismaClient().shopLevel.findUniqueOrThrow({ where: { id: fixture.shopLevelIds[1] } });
    const duplicate = await request(app).patch(`/api/admin/v1/shop-plan-levels/${targetId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: duplicateName.name });
    const invalidDuration = await request(app).patch(`/api/admin/v1/shop-plan-levels/${targetId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ durationId: 999_999_999 });
    const after = await getPrismaClient().shopLevel.findUniqueOrThrow({ where: { id: targetId } });

    expect(duplicate.body.error.code).toBe('SHOP_LEVEL_NAME_CONFLICT');
    expect(invalidDuration.body.error.code).toBe('INVALID_REFERENCE');
    expect(after).toEqual(original);
  });

  it('deletes an unreferenced level and blocks Shop, ShopUpgradeRequest, and Payment references without altering related rows', async () => {
    const prisma = getPrismaClient();
    const duration = await prisma.planDuration.findUniqueOrThrow({ where: { id: fixture.durationIds[0] } });
    const levels = await Promise.all(['Shop ref', 'Request ref', 'Payment ref', 'Unreferenced'].map((label) => prisma.shopLevel.create({ data: { name: `${label} ${randomUUID()}`, durationId: duration.id, duration: duration.value } })));
    fixture.shopLevelIds.push(...levels.map(({ id }) => id));
    const member = await prisma.member.create({ data: { name: 'Scoped Reference Owner', code: `REF-${randomUUID()}`, password: 'hash' } });
    fixture.memberIds.push(member.id);
    const shop = await prisma.shop.create({ data: { name: 'Scoped Referencing Shop', memberId: member.id, shopLevelId: levels[0].id } });
    fixture.shopIds.push(shop.id);
    const upgradeRequest = await prisma.shopUpgradeRequest.create({ data: { memberId: member.id, shopLevelId: levels[1].id, postCount: 11 } });
    fixture.requestIds.push(upgradeRequest.id);
    const bank = await prisma.bankInformation.create({ data: { name: 'Scoped Bank', bankAccountHolder: 'Holder', bankAccountNumber: randomUUID(), phone: `09${Date.now()}` } });
    fixture.bankIds.push(bank.id);
    const payment = await prisma.payment.create({ data: { name: `PAY-${randomUUID()}`, memberId: member.id, requestType: PaymentRequestType.SHOP_LEVEL_UPGRADE, shopLevelId: levels[2].id, bankInformationId: bank.id, attachment: '/synthetic-proof.png' } });
    fixture.paymentIds.push(payment.id);

    const app = createApp();
    const responses = await Promise.all(levels.map((level) => request(app).delete(`/api/admin/v1/shop-plan-levels/${level.id}`).set('Authorization', `Bearer ${token(fixture.adminId)}`)));
    const [shopAfter, requestAfter, paymentAfter] = await Promise.all([
      prisma.shop.findUniqueOrThrow({ where: { id: shop.id } }),
      prisma.shopUpgradeRequest.findUniqueOrThrow({ where: { id: upgradeRequest.id } }),
      prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([409, 409, 409, 204]);
    expect(responses.slice(0, 3).map(({ body }) => body.error.code)).toEqual(['SHOP_LEVEL_IN_USE', 'SHOP_LEVEL_IN_USE', 'SHOP_LEVEL_IN_USE']);
    expect(responses[0].body.error.details).toEqual({ shops: 1, shopUpgradeRequests: 0, payments: 0 });
    expect(responses[1].body.error.details).toEqual({ shops: 0, shopUpgradeRequests: 1, payments: 0 });
    expect(responses[2].body.error.details).toEqual({ shops: 0, shopUpgradeRequests: 0, payments: 1 });
    expect(shopAfter.shopLevelId).toBe(levels[0].id);
    expect(requestAfter).toMatchObject({ shopLevelId: levels[1].id, postCount: 11 });
    expect(paymentAfter.shopLevelId).toBe(levels[2].id);
    expect(await prisma.shopLevel.findUnique({ where: { id: levels[3].id } })).toBeNull();
    fixture.shopLevelIds = fixture.shopLevelIds.filter((id) => id !== levels[3].id);
  });
});
