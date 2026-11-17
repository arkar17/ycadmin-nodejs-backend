import {
  MemberRequestStatus,
  PaymentRequestType,
  PaymentStatus,
  PaymentTypes,
} from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import { AppError } from '../../shared/app-error.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { PaymentPushNotificationService } from './payment-push.service.js';
import type { PaymentRecord, PaymentRepository } from './payment.repository.js';
import { createPaymentRouter } from './payment.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id = 1) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (id = 1) => ({ Authorization: `Bearer ${token(id)}` });
const date = new Date('2026-11-17T00:00:00.000Z');

const record = (status = PaymentStatus.DRAFT): PaymentRecord => ({
  id: 7,
  name: 'YC/26/000007',
  memberId: 20,
  requestType: PaymentRequestType.MEMBER_PLAN_UPGRADE,
  memberPlanId: 30,
  memberTypeId: 40,
  shopLevelId: null,
  memberRequestId: 50,
  shopUpgradeRequestId: null,
  amount: 30_000,
  requestDate: date,
  status,
  approvedById: status === PaymentStatus.ACCEPT ? 1 : null,
  approvedAt: status === PaymentStatus.ACCEPT ? date : null,
  cancelledById: status === PaymentStatus.DECLINE ? 1 : null,
  cancelledAt: status === PaymentStatus.DECLINE ? date : null,
  cancelledReason: status === PaymentStatus.DECLINE ? 'Invalid proof' : null,
  createdAt: date,
  updatedAt: date,
  member: { id: 20, name: 'Member', code: 'YC0020' },
  memberPlan: { id: 30, name: 'Gym Plan' },
  memberType: { id: 40, name: 'Gym Member' },
  shopLevel: null,
  bankInformation: { id: 60, name: 'Safe Bank Name', paymentTypes: PaymentTypes.BANK_ACCOUNT },
  approvedBy: status === PaymentStatus.ACCEPT ? { id: 1, name: 'Admin' } : null,
  cancelledBy: status === PaymentStatus.DECLINE ? { id: 1, name: 'Admin' } : null,
  memberRequest: { id: 50, status: MemberRequestStatus.PENDING, memberId: 20, memberPlanId: 30, memberTypeId: 40 },
  shopUpgradeRequest: null,
  hasPaymentProof: true,
});

const repository = (overrides: Partial<PaymentRepository> = {}): PaymentRepository => ({
  findPage: vi.fn(async () => ({ records: [record()], total: 1 })),
  findById: vi.fn(async (id) => id === 7 ? record() : null),
  decide: vi.fn(async (input) => {
    const status = input.decision === 'accept' ? PaymentStatus.ACCEPT : PaymentStatus.DECLINE;
    return {
      changed: true,
      payment: record(status),
      pushTarget: { token: 'never-return-this-token', title: 'Decision', message: 'Decision' },
    };
  }),
  ...overrides,
});

const identity = (permissionNames: string[], roleNames: string[] = []): AdminIdentityRepository => ({
  findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Admin', roleNames, permissionNames })),
});

const app = (
  paymentRepository: PaymentRepository,
  permissionNames = ['payment:list', 'payment:read', 'payment:update'],
  roleNames: string[] = [],
  push: PaymentPushNotificationService = { send: vi.fn(async () => undefined) },
) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/payments', createPaymentRouter({
    adminIdentityRepository: identity(permissionNames, roleNames),
    paymentRepository,
    paymentPushNotificationService: push,
  }));
  value.use(errorHandler);
  return value;
};

describe('Payment router', () => {
  it('enforces list/read permissions while preserving System Admin bypass', async () => {
    const deniedList = await request(app(repository(), ['payment:read'])).get('/api/admin/v1/payments').set(auth());
    const deniedDetail = await request(app(repository(), ['payment:list'])).get('/api/admin/v1/payments/7').set(auth());
    const system = await request(app(repository(), [], [SYSTEM_ADMIN_ROLE_NAME])).get('/api/admin/v1/payments/7').set(auth());
    expect([deniedList.status, deniedDetail.status, system.status]).toEqual([403, 403, 200]);
  });

  it('validates filters strictly and passes canonical pagination/filter values', async () => {
    const repo = repository();
    const response = await request(app(repo)).get('/api/admin/v1/payments?status=DRAFT&requestType=MEMBER_PLAN_UPGRADE&memberId=20&minAmount=100&maxAmount=40000&limit=10&offset=20').set(auth());
    const invalidEnum = await request(app(repo)).get('/api/admin/v1/payments?status=pending').set(auth());
    const invalidRange = await request(app(repo)).get('/api/admin/v1/payments?minAmount=50&maxAmount=10').set(auth());
    const unknown = await request(app(repo)).get('/api/admin/v1/payments?secret=true').set(auth());
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ total: 1, limit: 10, offset: 20, currentPage: 3, totalPages: 1 });
    expect(repo.findPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'DRAFT', memberId: 20, minAmount: 100, maxAmount: 40_000 }));
    expect([invalidEnum.status, invalidRange.status, unknown.status]).toEqual([422, 422, 422]);
  });

  it('returns safe list/detail DTOs and deterministic missing behavior', async () => {
    const value = app(repository());
    const list = await request(value).get('/api/admin/v1/payments').set(auth());
    const detail = await request(value).get('/api/admin/v1/payments/7').set(auth());
    const missing = await request(value).get('/api/admin/v1/payments/999').set(auth());
    expect(list.body.data[0]).toMatchObject({ id: 7, hasPaymentProof: true, member: { code: 'YC0020' } });
    expect(detail.body.data).toMatchObject({ memberRequest: { id: 50, status: 'PENDING' }, bankInformation: { name: 'Safe Bank Name' } });
    expect(JSON.stringify([list.body, detail.body])).not.toMatch(/attachment|never-return-this-token|accountNumber|bankAccountHolder|phone/i);
    expect(missing.status).toBe(404);
  });

  it('accepts through payment:update and runs push only after a changed repository decision', async () => {
    const repo = repository();
    const push = { send: vi.fn(async () => undefined) };
    const response = await request(app(repo, undefined, [], push)).post('/api/admin/v1/payments/7/accept').set(auth()).send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ changed: true, payment: { status: 'ACCEPT' } });
    expect(repo.decide).toHaveBeenCalledWith({ paymentId: 7, actorUserId: 1, decision: 'accept' });
    expect(push.send).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 7, memberId: 20 }));
  });

  it('requires, trims, bounds, and strictly validates decline reason', async () => {
    const repo = repository();
    const value = app(repo);
    const valid = await request(value).post('/api/admin/v1/payments/7/decline').set(auth()).send({ reason: '  Invalid proof  ' });
    const missing = await request(value).post('/api/admin/v1/payments/7/decline').set(auth()).send({});
    const unknown = await request(value).post('/api/admin/v1/payments/7/decline').set(auth()).send({ reason: 'No', status: 'DECLINE' });
    expect(valid.status).toBe(200);
    expect(repo.decide).toHaveBeenCalledWith({ paymentId: 7, actorUserId: 1, decision: 'decline', reason: 'Invalid proof' });
    expect([missing.status, unknown.status]).toEqual([422, 422]);
  });

  it('propagates database failures but treats post-commit push failure as successful', async () => {
    const infrastructure = repository({ decide: vi.fn(async () => { throw new Error('database unavailable'); }) });
    const failed = await request(app(infrastructure)).post('/api/admin/v1/payments/7/accept').set(auth()).send({});
    const push = { send: vi.fn(async () => { throw new Error('FCM unavailable'); }) };
    const succeeded = await request(app(repository(), undefined, [], push)).post('/api/admin/v1/payments/7/accept').set(auth()).send({});
    expect(failed.status).toBe(500);
    expect(succeeded.status).toBe(200);
    expect(succeeded.body.data.changed).toBe(true);
  });

  it('passes deterministic state conflicts through the standard error envelope', async () => {
    const repo = repository({
      decide: vi.fn(async () => { throw new AppError({ statusCode: 409, code: 'PAYMENT_STATE_CONFLICT', message: 'Conflict.' }); }),
    });
    const response = await request(app(repo)).post('/api/admin/v1/payments/7/accept').set(auth()).send({});
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PAYMENT_STATE_CONFLICT');
  });
});
