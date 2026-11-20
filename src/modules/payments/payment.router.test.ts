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
import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PaymentProofFetchFailure, type PaymentProofFetcher } from '../payment-proof/payment-proof.fetcher.js';
import { PaymentProofImageFailure, type PaymentProofImageNormalizer } from '../payment-proof/payment-proof.image.js';
import { FcmPaymentPushNotificationService } from './fcm-payment-push.service.js';
import { PaymentProofService } from './payment-proof.service.js';
import type { PaymentPushNotificationService } from './payment-push.service.js';
import type { PaymentRecord, PaymentRepository } from './payment.repository.js';
import { createPaymentRouter } from './payment.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id = 1) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const auth = (id = 1) => ({ Authorization: `Bearer ${token(id)}` });
const date = new Date('2026-11-17T00:00:00.000Z');
const canonicalProof = 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png';
const proofConfig = (enabled = true): PaymentProofConfig => ({
  enabled,
  allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com',
  bucket: 'yc-fitness-uat',
  keyPrefix: 'payment-attachments/',
  maxBytes: 5_242_880,
  maxPixels: 40_000_000,
  timeoutMs: 5_000,
});

const record = (status = PaymentStatus.DRAFT, paymentProofAttachment = canonicalProof): PaymentRecord => ({
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
  paymentProofAttachment,
});

const repository = (overrides: Partial<PaymentRepository> = {}): PaymentRepository => ({
  findPage: vi.fn(async () => ({ records: [record()], total: 1 })),
  findById: vi.fn(async (id) => id === 7 ? record() : null),
  findPaymentProofContext: vi.fn(async (id) => id === 7 ? { attachment: canonicalProof } : null),
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
  paymentProofService?: PaymentProofService,
) => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/payments', createPaymentRouter({
    adminIdentityRepository: identity(permissionNames, roleNames),
    paymentRepository,
    paymentPushNotificationService: push,
    ...(paymentProofService ? { paymentProofService } : {}),
  }));
  value.use(errorHandler);
  return value;
};

const proofService = (
  repo: PaymentRepository,
  config: PaymentProofConfig = proofConfig(),
  fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('source'), mediaType: 'image/png' })) },
  normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-webp')) },
) => new PaymentProofService(repo, config, fetcher, normalizer);

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

  it('classifies proof metadata without returning the stored attachment', async () => {
    const cases = [
      { attachment: canonicalProof, config: proofConfig(), status: 'AVAILABLE', hasPath: true },
      { attachment: '', config: proofConfig(), status: 'MISSING', hasPath: false },
      { attachment: 'private/legacy-proof-key', config: proofConfig(), status: 'UNSUPPORTED_FORMAT', hasPath: false },
      { attachment: canonicalProof, config: proofConfig(false), status: 'FEATURE_DISABLED', hasPath: false },
    ] as const;

    for (const item of cases) {
      const payment = record(PaymentStatus.DRAFT, item.attachment);
      const repo = repository({
        findPage: vi.fn(async () => ({ records: [payment], total: 1 })),
        findById: vi.fn(async () => payment),
        findPaymentProofContext: vi.fn(async () => ({ attachment: item.attachment })),
      });
      const value = app(repo, undefined, [], undefined, proofService(repo, item.config));
      const list = await request(value).get('/api/admin/v1/payments').set(auth());
      const detail = await request(value).get('/api/admin/v1/payments/7').set(auth());
      for (const dto of [list.body.data[0], detail.body.data]) {
        expect(dto).toMatchObject({
          hasPaymentProof: item.attachment.length > 0,
          paymentProofStatus: item.status,
        });
        if (item.hasPath) expect(dto.paymentProofPath).toBe('/api/admin/v1/payments/7/proof');
        else expect(dto).not.toHaveProperty('paymentProofPath');
        expect(dto).not.toHaveProperty('paymentProofAttachment');
        if (item.attachment.length > 0) expect(JSON.stringify(dto)).not.toContain(item.attachment);
      }
    }
  });

  it('protects proof viewing, supports System Admin bypass, and returns normalized WebP with safe headers', async () => {
    const repo = repository();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('source'), mediaType: 'image/png' })) };
    const normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-webp')) };
    const service = proofService(repo, proofConfig(), fetcher, normalizer);
    const denied = await request(app(repo, ['payment:list'], [], undefined, service)).get('/api/admin/v1/payments/7/proof').set(auth());
    const response = await request(app(repo, ['payment:read'], [], undefined, service)).get('/api/admin/v1/payments/7/proof').set(auth());
    const bypass = await request(app(repo, [], [SYSTEM_ADMIN_ROLE_NAME], undefined, service)).get('/api/admin/v1/payments/7/proof').set(auth());

    expect(denied.status).toBe(403);
    expect([response.status, bypass.status]).toEqual([200, 200]);
    expect(response.body).toEqual(Buffer.from('normalized-webp'));
    expect(response.headers).toMatchObject({
      'content-type': 'image/webp',
      'content-disposition': 'inline; filename="payment-proof.webp"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store, max-age=0',
      'content-security-policy': "sandbox; default-src 'none'",
    });
    expect(fetcher.fetch).toHaveBeenCalledWith('https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png');
    expect(repo.decide).not.toHaveBeenCalled();
  });

  it('returns safe missing, disabled, and unsupported proof errors before any fetch', async () => {
    const fetcher: PaymentProofFetcher = { fetch: vi.fn() };
    const missingPayment = repository({ findPaymentProofContext: vi.fn(async () => null) });
    const missingProof = repository({ findPaymentProofContext: vi.fn(async () => ({ attachment: '' })) });
    const unsupported = repository({ findPaymentProofContext: vi.fn(async () => ({ attachment: 'private/legacy-proof-key' })) });
    const disabled = repository();

    const responses = await Promise.all([
      request(app(missingPayment, undefined, [], undefined, proofService(missingPayment, proofConfig(), fetcher))).get('/api/admin/v1/payments/999/proof').set(auth()),
      request(app(missingProof, undefined, [], undefined, proofService(missingProof, proofConfig(), fetcher))).get('/api/admin/v1/payments/7/proof').set(auth()),
      request(app(unsupported, undefined, [], undefined, proofService(unsupported, proofConfig(), fetcher))).get('/api/admin/v1/payments/7/proof').set(auth()),
      request(app(disabled, undefined, [], undefined, proofService(disabled, proofConfig(false), fetcher))).get('/api/admin/v1/payments/7/proof').set(auth()),
    ]);

    expect(responses.map((entry) => [entry.status, entry.body.error.code])).toEqual([
      [404, 'NOT_FOUND'],
      [404, 'PAYMENT_PROOF_NOT_FOUND'],
      [422, 'PAYMENT_PROOF_UNSUPPORTED'],
      [503, 'PAYMENT_PROOF_UNAVAILABLE'],
    ]);
    expect(JSON.stringify(responses.map((entry) => entry.body))).not.toMatch(/private\/legacy|digitaloceanspaces|attachment/i);
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['UPSTREAM', 502, 'PAYMENT_PROOF_UPSTREAM_UNAVAILABLE'],
    ['TIMEOUT', 504, 'PAYMENT_PROOF_TIMEOUT'],
    ['TOO_LARGE', 422, 'PAYMENT_PROOF_TOO_LARGE'],
    ['INVALID_CONTENT', 422, 'PAYMENT_PROOF_INVALID_CONTENT'],
  ] as const)('maps %s proof fetch failures safely', async (kind, status, code) => {
    const repo = repository();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => { throw new PaymentProofFetchFailure(kind); }) };
    const response = await request(app(repo, undefined, [], undefined, proofService(repo, proofConfig(), fetcher)))
      .get('/api/admin/v1/payments/7/proof').set(auth());
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain(canonicalProof);
  });

  it('maps image normalization failures and rejects malformed IDs', async () => {
    const repo = repository();
    const normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => { throw new PaymentProofImageFailure('INVALID_CONTENT'); }) };
    const service = proofService(repo, proofConfig(), undefined, normalizer);
    const invalidImage = await request(app(repo, undefined, [], undefined, service)).get('/api/admin/v1/payments/7/proof').set(auth());
    const invalidId = await request(app(repo, undefined, [], undefined, service)).get('/api/admin/v1/payments/0/proof').set(auth());
    expect([invalidImage.status, invalidImage.body.error.code]).toEqual([422, 'PAYMENT_PROOF_INVALID_CONTENT']);
    expect(invalidId.status).toBe(422);
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

  it('returns the committed decision over HTTP when the FCM adapter fails', async () => {
    const sender = { send: vi.fn(async () => { throw Object.assign(new Error('never-return-this-token'), { code: 'messaging/registration-token-not-registered' }); }) };
    const push = new FcmPaymentPushNotificationService(sender, { timeoutMs: 5000 }, { info: vi.fn() });
    const accepted = await request(app(repository(), undefined, [], push)).post('/api/admin/v1/payments/7/accept').set(auth()).send({});
    const declined = await request(app(repository(), undefined, [], push)).post('/api/admin/v1/payments/7/decline').set(auth()).send({ reason: 'Invalid proof' });
    expect([accepted.status, declined.status]).toEqual([200, 200]);
    expect(accepted.body.data).toMatchObject({ changed: true, payment: { status: 'ACCEPT' } });
    expect(declined.body.data).toMatchObject({ changed: true, payment: { status: 'DECLINE' } });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([accepted.body, declined.body])).not.toContain('never-return-this-token');
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
