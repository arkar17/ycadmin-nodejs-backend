import {
  MemberRequestStatus,
  PaymentRequestType,
  PaymentStatus,
  Status,
} from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { assertIsolatedIntegrationDatabaseUrl } from '../../tests/integration-database-safety.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import type { PaymentPushNotificationService } from './payment-push.service.js';
import { createPaymentRouter } from './payment.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });

type Fixture = {
  firstAdminId: number;
  secondAdminId: number;
  roleId: number;
  updatePermissionId: number;
  memberId: number;
  memberRequestId: number;
  memberPaymentId: number;
  shopId: number;
  shopUpgradeRequestId: number;
  shopPaymentId: number;
  standalonePaymentId: number;
  invalidPaymentId: number;
  originalMemberTypeId: number;
  originalShopLevelId: number;
};

const app = (push?: PaymentPushNotificationService) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/payments', createPaymentRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    ...(push ? { paymentPushNotificationService: push } : {}),
  }));
  value.use(errorHandler);
  return value;
};

const reset = async (): Promise<Fixture> => {
  assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_notification_failure ON "Notification"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_payment_notification()');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_decision_delay ON "Payment"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS delay_payment_decision()');
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Notification", "MemberFcmToken", "Payment", "MemberRequest", "ShopUpgradeRequest", "Shop", "BankInformation", "MemberPlan", "ShopLevel", "PlanDuration", "MemberType", "RolePermission", "UserRole", "Permission", "Role", "User", "Member" RESTART IDENTITY CASCADE',
  );

  const permissionNames = ['payment:list', 'payment:read', 'payment:update'];
  const permissions = await Promise.all(permissionNames.map((name) => prisma.permission.create({ data: { name } })));
  const role = await prisma.role.create({ data: { name: 'Payment Integration Admin' } });
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const [firstAdmin, secondAdmin] = await Promise.all([
    prisma.user.create({ data: { name: 'Payment Admin A', email: 'payment-a@example.test', username: 'payment-a', password: 'hash' } }),
    prisma.user.create({ data: { name: 'Payment Admin B', email: 'payment-b@example.test', username: 'payment-b', password: 'hash' } }),
  ]);
  await prisma.userRole.createMany({ data: [
    { userId: firstAdmin.id, roleId: role.id },
    { userId: secondAdmin.id, roleId: role.id },
  ] });

  const [gymType, trainerType] = await Promise.all([
    prisma.memberType.create({ data: { name: 'Gym Member' } }),
    prisma.memberType.create({ data: { name: 'Trainer Member' } }),
  ]);
  const duration = await prisma.planDuration.create({ data: { name: 'Three Months', value: 3 } });
  const plan = await prisma.memberPlan.create({ data: {
    name: 'Integration Gym Plan',
    memberTypeId: gymType.id,
    duration: 3,
    durationId: duration.id,
    price: 30_000,
  } });
  const [currentShopLevel, requestedShopLevel] = await Promise.all([
    prisma.shopLevel.create({ data: { name: 'Current Shop Level', price: 0 } }),
    prisma.shopLevel.create({ data: { name: 'Requested Shop Level', price: 50_000 } }),
  ]);
  const member = await prisma.member.create({ data: {
    name: 'Payment Member',
    code: 'PAY-001',
    password: 'hash',
    memberTypeId: gymType.id,
  } });
  await prisma.memberFcmToken.create({ data: { memberId: member.id, token: 'synthetic-fcm-token' } });
  const shop = await prisma.shop.create({ data: { name: 'Payment Shop', memberId: member.id, shopLevelId: currentShopLevel.id } });
  const [memberRequest, shopRequest] = await Promise.all([
    prisma.memberRequest.create({ data: {
      memberId: member.id,
      memberTypeId: gymType.id,
      memberPlanId: plan.id,
      status: MemberRequestStatus.PENDING,
    } }),
    prisma.shopUpgradeRequest.create({ data: {
      memberId: member.id,
      shopLevelId: requestedShopLevel.id,
      status: MemberRequestStatus.PENDING,
    } }),
  ]);
  const bank = await prisma.bankInformation.create({ data: {
    name: 'Payment Test Bank',
    bankAccountHolder: 'Sensitive Holder',
    bankAccountNumber: '1234567890123456',
    phone: '09123456789',
  } });
  const [memberPayment, shopPayment, standalonePayment, invalidPayment] = await Promise.all([
    prisma.payment.create({ data: {
      name: 'YC/26/000001',
      memberId: member.id,
      requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE,
      memberPlanId: plan.id,
      memberTypeId: gymType.id,
      memberRequestId: memberRequest.id,
      bankInformationId: bank.id,
      amount: 30_000,
      attachment: 'private/member-proof-key',
      status: PaymentStatus.DRAFT,
      cancelledById: secondAdmin.id,
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      cancelledReason: 'stale decline data',
    } }),
    prisma.payment.create({ data: {
      name: 'YC/26/000002',
      memberId: member.id,
      requestType: PaymentRequestType.SHOP_LEVEL_UPGRADE,
      shopLevelId: requestedShopLevel.id,
      shopUpgradeRequestId: shopRequest.id,
      bankInformationId: bank.id,
      amount: 50_000,
      attachment: 'private/shop-proof-key',
      status: PaymentStatus.DRAFT,
      approvedById: secondAdmin.id,
      approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    } }),
    prisma.payment.create({ data: {
      name: 'YC/26/000003',
      memberId: member.id,
      requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE,
      memberPlanId: plan.id,
      memberTypeId: gymType.id,
      bankInformationId: bank.id,
      amount: 30_000,
      attachment: 'private/standalone-proof-key',
      status: PaymentStatus.DRAFT,
    } }),
    prisma.payment.create({ data: {
      name: 'YC/26/000004',
      memberId: member.id,
      requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE,
      memberPlanId: null,
      memberTypeId: trainerType.id,
      bankInformationId: bank.id,
      amount: 1,
      attachment: '',
      status: PaymentStatus.DRAFT,
    } }),
  ]);

  return {
    firstAdminId: firstAdmin.id,
    secondAdminId: secondAdmin.id,
    roleId: role.id,
    updatePermissionId: permissions.find((permission) => permission.name === 'payment:update')!.id,
    memberId: member.id,
    memberRequestId: memberRequest.id,
    memberPaymentId: memberPayment.id,
    shopId: shop.id,
    shopUpgradeRequestId: shopRequest.id,
    shopPaymentId: shopPayment.id,
    standalonePaymentId: standalonePayment.id,
    invalidPaymentId: invalidPayment.id,
    originalMemberTypeId: gymType.id,
    originalShopLevelId: currentShopLevel.id,
  };
};

describe('Payment management on isolated PostgreSQL', () => {
  let fixture: Fixture;

  beforeEach(async () => { fixture = await reset(); });

  afterEach(async () => {
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_notification_failure ON "Notification"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_payment_notification()');
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_decision_delay ON "Payment"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS delay_payment_decision()');
  });

  afterAll(async () => { await disconnectDatabase(); });

  it('lists and details filtered payments without exposing proof or bank credentials', async () => {
    const value = app();
    const authorization = `Bearer ${token(fixture.firstAdminId)}`;
    const list = await request(value)
      .get(`/api/admin/v1/payments?requestType=MEMBER_PLAN_UPGRADE&memberId=${fixture.memberId}&minAmount=100&limit=10&offset=0`)
      .set('Authorization', authorization);
    const detail = await request(value).get(`/api/admin/v1/payments/${fixture.memberPaymentId}`).set('Authorization', authorization);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: fixture.memberPaymentId, status: 'DRAFT', hasPaymentProof: true })]));
    expect(detail.body.data).toMatchObject({
      id: fixture.memberPaymentId,
      memberRequest: { id: fixture.memberRequestId, status: 'PENDING' },
      bankInformation: { name: 'Payment Test Bank' },
    });
    expect(JSON.stringify([list.body, detail.body])).not.toMatch(/private\/|attachment|1234567890123456|Sensitive Holder|09123456789/);
  });

  it('blocks request-managed payments while leaving reads intact and allowing an unrelated payment', async () => {
    const value = app(); const authorization = `Bearer ${token(fixture.firstAdminId)}`;
    const [memberManaged, shopManaged, standalone] = await Promise.all([
      request(value).post(`/api/admin/v1/payments/${fixture.memberPaymentId}/accept`).set('Authorization', authorization).send({}),
      request(value).post(`/api/admin/v1/payments/${fixture.shopPaymentId}/decline`).set('Authorization', authorization).send({ reason: 'No' }),
      request(value).post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`).set('Authorization', authorization).send({}),
    ]);
    expect([memberManaged.status, shopManaged.status, standalone.status]).toEqual([409, 409, 200]);
    expect(memberManaged.body.error.code).toBe('PAYMENT_MANAGED_BY_REQUEST');
    expect(shopManaged.body.error.code).toBe('PAYMENT_MANAGED_BY_REQUEST');
    const prisma = getPrismaClient();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.memberPaymentId } })).status).toBe(PaymentStatus.DRAFT);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: fixture.shopPaymentId } })).status).toBe(PaymentStatus.DRAFT);
  });

  it('atomically accepts a Payment and Notification while leaving membership data unchanged', async () => {
    const push = { send: vi.fn(async () => { throw new Error('synthetic FCM failure'); }) };
    const response = await request(app(push))
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ changed: true, payment: { status: 'ACCEPT' } });
    const prisma = getPrismaClient();
    const [payment, notification, member, memberRequest] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId } }),
      prisma.notification.findFirstOrThrow({ where: { resId: fixture.standalonePaymentId, model: 'system' } }),
      prisma.member.findUniqueOrThrow({ where: { id: fixture.memberId } }),
      prisma.memberRequest.findUniqueOrThrow({ where: { id: fixture.memberRequestId } }),
    ]);
    expect(payment).toMatchObject({
      status: PaymentStatus.ACCEPT,
      approvedById: fixture.firstAdminId,
      cancelledById: null,
      cancelledAt: null,
      cancelledReason: null,
    });
    expect(payment.approvedAt).toBeInstanceOf(Date);
    expect(notification).toMatchObject({
      toUserId: fixture.memberId,
      resId: fixture.standalonePaymentId,
      type: 'SYSTEM',
      isSeen: false,
      isRead: false,
      message: 'Your payment has been accepted.',
    });
    expect(member.memberTypeId).toBe(fixture.originalMemberTypeId);
    expect(memberRequest.status).toBe(MemberRequestStatus.PENDING);
    expect(push.send).toHaveBeenCalledOnce();

    const repeated = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({});
    const opposite = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/decline`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({ reason: 'Too late' });
    expect(repeated.body.data.changed).toBe(false);
    expect(opposite.status).toBe(409);
    expect(await prisma.notification.count({ where: { resId: fixture.standalonePaymentId } })).toBe(1);
  });

  it('keeps Payment and Notification committed when the FCM adapter fails (fake sender, no Firebase)', async () => {
    const sender = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('synthetic provider failure'), { code: 'messaging/server-unavailable' });
      }),
    };
    const push = new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, { info: vi.fn() });
    const response = await request(app(push))
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ changed: true, payment: { status: 'ACCEPT' } });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(sender.send).toHaveBeenCalledWith({
      token: 'synthetic-fcm-token',
      notification: { title: 'Your payment has been accepted.', body: 'Your payment has been accepted.' },
    });
    const prisma = getPrismaClient();
    const [payment, notifications] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId }, select: { status: true } }),
      prisma.notification.findMany({ where: { resId: fixture.standalonePaymentId } }),
    ]);
    expect(payment.status).toBe(PaymentStatus.ACCEPT);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: 'Your payment has been accepted.',
      message: 'Your payment has been accepted.',
      model: 'system',
      type: 'SYSTEM',
      toUserId: fixture.memberId,
    });
    expect(await prisma.memberFcmToken.count({ where: { memberId: fixture.memberId } })).toBe(1);
  });

  it('declines with trimmed reason and leaves Shop/ShopUpgradeRequest unchanged', async () => {
    const response = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/decline`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({ reason: '  Proof cannot be verified  ' });
    expect(response.status).toBe(200);
    const prisma = getPrismaClient();
    const [payment, notification, shop, shopRequest] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId } }),
      prisma.notification.findFirstOrThrow({ where: { resId: fixture.standalonePaymentId } }),
      prisma.shop.findUniqueOrThrow({ where: { id: fixture.shopId } }),
      prisma.shopUpgradeRequest.findUniqueOrThrow({ where: { id: fixture.shopUpgradeRequestId } }),
    ]);
    expect(payment).toMatchObject({
      status: PaymentStatus.DECLINE,
      cancelledById: fixture.firstAdminId,
      cancelledReason: 'Proof cannot be verified',
      approvedById: null,
      approvedAt: null,
    });
    expect(notification.message).toBe('Your payment has been declined.');
    expect(shop.shopLevelId).toBe(fixture.originalShopLevelId);
    expect(shopRequest.status).toBe(MemberRequestStatus.PENDING);

    const repeated = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/decline`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({ reason: 'A different retry reason is ignored' });
    const opposite = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({});
    expect(repeated.body.data.changed).toBe(false);
    expect(opposite.status).toBe(409);
    expect(await prisma.notification.count({ where: { resId: fixture.standalonePaymentId } })).toBe(1);
  });

  it('rolls back the Payment decision when Notification insertion fails', async () => {
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_payment_notification() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic notification failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER payment_notification_failure BEFORE INSERT ON "Notification"
      FOR EACH ROW EXECUTE FUNCTION fail_payment_notification()
    `);
    const response = await request(app())
      .post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`)
      .set('Authorization', `Bearer ${token(fixture.firstAdminId)}`)
      .send({});
    expect(response.status).toBe(500);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId }, select: { status: true } })).toEqual({ status: PaymentStatus.DRAFT });
    expect(await prisma.notification.count({ where: { resId: fixture.standalonePaymentId } })).toBe(0);
  });

  it('allows only one conflicting concurrent terminal decision to win', async () => {
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION delay_payment_decision() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(0.15);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER payment_decision_delay BEFORE UPDATE OF status ON "Payment"
      FOR EACH ROW WHEN (OLD.status = 'DRAFT') EXECUTE FUNCTION delay_payment_decision()
    `);
    const value = app();
    const [accept, decline] = await Promise.all([
      request(value).post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`).set('Authorization', `Bearer ${token(fixture.firstAdminId)}`).send({}),
      request(value).post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/decline`).set('Authorization', `Bearer ${token(fixture.secondAdminId)}`).send({ reason: 'Concurrent decline' }),
    ]);
    expect([accept.status, decline.status].sort()).toEqual([200, 409]);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId } });
    expect([PaymentStatus.ACCEPT, PaymentStatus.DECLINE]).toContain(stored.status);
    expect(await prisma.notification.count({ where: { resId: fixture.standalonePaymentId } })).toBe(1);
  });

  it('rejects structurally invalid history and honors permission revocation on the next request', async () => {
    const value = app();
    const authorization = `Bearer ${token(fixture.firstAdminId)}`;
    const invalid = await request(value).post(`/api/admin/v1/payments/${fixture.invalidPaymentId}/accept`).set('Authorization', authorization).send({});
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('PAYMENT_RELATIONSHIP_INVALID');
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.updatePermissionId } });
    const revoked = await request(value).post(`/api/admin/v1/payments/${fixture.standalonePaymentId}/accept`).set('Authorization', authorization).send({});
    expect(revoked.status).toBe(403);
    expect(await getPrismaClient().payment.findUniqueOrThrow({ where: { id: fixture.standalonePaymentId }, select: { status: true } })).toEqual({ status: PaymentStatus.DRAFT });
  });
});
