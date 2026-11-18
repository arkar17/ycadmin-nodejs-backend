import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MemberRequestStatus, PaymentStatus } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { MembershipRequestRecord, MembershipRequestRepository } from './membership-request.repository.js';
import { createMembershipRequestRouter } from './membership-request.router.js';
import type { PaymentProofConfig } from '../../config/payment-proof.js';
import { MembershipPaymentProofService } from './payment-proof.service.js';
import type { PaymentProofFetcher } from './payment-proof.fetcher.js';
import type { PaymentProofImageNormalizer } from './payment-proof.image.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['member-request:list', 'member-request:read', 'member-request:update'];
const canonicalAttachment = 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com/yc-fitness-uat/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png';
const record: MembershipRequestRecord = { id: 1, name: null, status: MemberRequestStatus.PENDING, rejectedReason: null, approvedAt: null, rejectedAt: null, createdAt: new Date('2026-10-10T00:00:00.000Z'), member: { id: 4, name: 'Synthetic Member', code: 'MR-001' }, memberType: { id: 29, name: 'Gym' }, memberPlan: { id: 3, name: 'Three Months', price: 3000, duration: 3, planDuration: { id: 1, name: '3 Months', value: 3 } }, payments: [{ id: 8, status: PaymentStatus.DRAFT, amount: 3000, requestDate: new Date('2026-10-10T00:00:00.000Z'), hasProof: true, bankInformation: { id: 5, name: 'Safe Bank', paymentTypes: 'BANK_ACCOUNT' }, structurallyMatches: true, attachment: canonicalAttachment }] };
const identity = (permissionNames = permissions, roleNames: string[] = []): AdminIdentityRepository => ({ findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Admin', roleNames, permissionNames })) });
const repository = (): MembershipRequestRepository => ({
  findPage: vi.fn(async () => ({ records: [record], total: 1 })),
  findById: vi.fn(async (id) => id === 1 ? record : null),
  findPaymentProofContext: vi.fn(async (requestId, paymentId) => requestId === 1 && paymentId === 8 ? { attachment: canonicalAttachment } : null),
  approve: vi.fn(async () => ({ changed: true, request: { ...record, status: MemberRequestStatus.APPROVED } })),
  reject: vi.fn(async () => ({ changed: true, request: { ...record, status: MemberRequestStatus.REJECTED, rejectedReason: 'No proof' } })),
});
const proofConfig: PaymentProofConfig = { enabled: true, allowedOrigin: 'https://yc-fitness-uat.sgp1.digitaloceanspaces.com', bucket: 'yc-fitness-uat', keyPrefix: 'payment-attachments/', maxBytes: 5_242_880, maxPixels: 40_000_000, timeoutMs: 5_000 };
const proofService = (repo: MembershipRequestRepository, fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('source'), mediaType: 'image/png' })) }, normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-webp')) }) => new MembershipPaymentProofService(repo, proofConfig, fetcher, normalizer);
const app = (repo: MembershipRequestRepository, permissionNames = permissions, roleNames: string[] = [], paymentProofService = proofService(repo)) => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/membership-requests', createMembershipRequestRouter({ adminIdentityRepository: identity(permissionNames, roleNames), membershipRequestRepository: repo, paymentProofService })); value.use(errorHandler); return value; };
const headers = () => ({ Authorization: `Bearer ${jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' })}` });

describe('Membership Request router', () => {
  it('enforces distinct list/read permissions and returns safe canonical-status DTOs', async () => {
    const list = await request(app(repository())).get('/api/admin/v1/membership-requests?member_name=Synthetic&member_plan_id=3&status=PENDING&date=2026-10-10&limit=1').set(headers());
    const forbidden = await request(app(repository(), ['member-request:list'])).get('/api/admin/v1/membership-requests/1').set(headers());
    const detail = await request(app(repository())).get('/api/admin/v1/membership-requests/1').set(headers());
    expect(list.status).toBe(200); expect(list.body.data[0]).toMatchObject({ status: 'PENDING', member: { clientCode: 'MR-001' }, memberPlan: { currentPrice: 3000 }, payments: [{ hasPaymentProof: true, paymentProofStatus: 'AVAILABLE', paymentProofPath: '/api/admin/v1/membership-requests/1/payments/8/proof', structurallyMatches: true, paymentDestination: { name: 'Safe Bank' } }] });
    expect(list.body.data[0]).not.toHaveProperty('attachment'); expect(list.body.data[0]).not.toHaveProperty('password');
    expect(forbidden.status).toBe(403); expect(detail.body.data).toHaveProperty('rejectedReason', null);
  });
  it('rejects legacy Odoo status aliases and conflicting aliases', async () => {
    const legacy = await request(app(repository())).get('/api/admin/v1/membership-requests?status=draft').set(headers());
    const conflict = await request(app(repository())).get('/api/admin/v1/membership-requests?memberName=A&member_name=B').set(headers());
    expect(legacy.status).toBe(422); expect(conflict.status).toBe(422);
  });
  it('returns 404 and 422 without revealing payment proof storage data', async () => {
    const missing = await request(app(repository())).get('/api/admin/v1/membership-requests/99').set(headers());
    const malformed = await request(app(repository())).get('/api/admin/v1/membership-requests?date=2026-02-30').set(headers());
    expect(missing.status).toBe(404); expect(malformed.status).toBe(422); expect(JSON.stringify(missing.body)).not.toContain('attachment');
  });
  it('strictly validates decisions and requires update permission with System Admin bypass', async () => {
    const repo = repository();
    const missingPayment = await request(app(repo)).post('/api/admin/v1/membership-requests/1/approve').set(headers()).send({});
    const unknown = await request(app(repo)).post('/api/admin/v1/membership-requests/1/approve').set(headers()).send({ paymentId: 8, extra: true });
    const blankReason = await request(app(repo)).post('/api/admin/v1/membership-requests/1/reject').set(headers()).send({ paymentId: 8, reason: '   ' });
    const forbidden = await request(app(repo, ['member-request:read'])).post('/api/admin/v1/membership-requests/1/approve').set(headers()).send({ paymentId: 8 });
    const approved = await request(app(repo)).post('/api/admin/v1/membership-requests/1/approve').set(headers()).send({ paymentId: 8 });
    const rejected = await request(app(repo)).post('/api/admin/v1/membership-requests/1/reject').set(headers()).send({ paymentId: 8, reason: '  No proof  ' });
    const bypass = await request(app(repo, [], ['SuperAdmin'])).post('/api/admin/v1/membership-requests/1/approve').set(headers()).send({ paymentId: 8 });
    expect([missingPayment.status, unknown.status, blankReason.status]).toEqual([422, 422, 422]);
    expect(forbidden.status).toBe(403);
    expect(approved.body.data).toMatchObject({ changed: true, membershipRequest: { status: 'APPROVED' } });
    expect(rejected.body.data).toMatchObject({ changed: true, membershipRequest: { status: 'REJECTED', rejectedReason: 'No proof' } });
    expect(repo.reject).toHaveBeenCalledWith({ requestId: 1, paymentId: 8, actorUserId: 1, reason: 'No proof' });
    expect(bypass.status).toBe(200);
  });
  it('protects proof access, derives the trusted target, and returns safe image headers', async () => {
    const repo = repository();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('source'), mediaType: 'image/png' })) };
    const normalizer: PaymentProofImageNormalizer = { normalize: vi.fn(async () => Buffer.from('normalized-webp')) };
    const forbidden = await request(app(repo, ['member-request:list'], [], proofService(repo, fetcher, normalizer))).get('/api/admin/v1/membership-requests/1/payments/8/proof').set(headers());
    const response = await request(app(repo, permissions, [], proofService(repo, fetcher, normalizer))).get('/api/admin/v1/membership-requests/1/payments/8/proof').set(headers());
    const bypass = await request(app(repo, [], ['SuperAdmin'], proofService(repo, fetcher, normalizer))).get('/api/admin/v1/membership-requests/1/payments/8/proof').set(headers());
    expect(forbidden.status).toBe(403);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'content-type': 'image/webp',
      'content-disposition': 'inline; filename="payment-proof.webp"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'content-security-policy': "sandbox; default-src 'none'",
    });
    expect(fetcher.fetch).toHaveBeenCalledWith('https://yc-fitness-uat.sgp1.digitaloceanspaces.com/payment-attachments/123e4567-e89b-42d3-a456-426614174000.png');
    expect(fetcher.fetch).not.toHaveBeenCalledWith(canonicalAttachment);
    expect(bypass.status).toBe(200);
  });
  it('rejects malformed and non-positive proof route IDs before repository or network access', async () => {
    const repo = repository();
    const fetcher: PaymentProofFetcher = { fetch: vi.fn(async () => ({ bytes: Buffer.from('source'), mediaType: 'image/png' })) };
    const service = proofService(repo, fetcher);
    const responses = await Promise.all([
      request(app(repo, permissions, [], service)).get('/api/admin/v1/membership-requests/0/payments/8/proof').set(headers()),
      request(app(repo, permissions, [], service)).get('/api/admin/v1/membership-requests/1/payments/-1/proof').set(headers()),
      request(app(repo, permissions, [], service)).get('/api/admin/v1/membership-requests/1.5/payments/8/proof').set(headers()),
      request(app(repo, permissions, [], service)).get('/api/admin/v1/membership-requests/1/payments/not-a-number/proof').set(headers()),
    ]);
    expect(responses.map((response) => response.status)).toEqual([422, 422, 422, 422]);
    expect(repo.findPaymentProofContext).not.toHaveBeenCalled();
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
});
