import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { MemberRequestStatus, PaymentStatus } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { MembershipRequestRecord, MembershipRequestRepository } from './membership-request.repository.js';
import { createMembershipRequestRouter } from './membership-request.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['member-request:list', 'member-request:read'];
const record: MembershipRequestRecord = { id: 1, name: null, status: MemberRequestStatus.PENDING, rejectedReason: null, approvedAt: null, rejectedAt: null, createdAt: new Date('2026-10-10T00:00:00.000Z'), member: { id: 4, name: 'Synthetic Member', code: 'MR-001' }, memberType: { id: 2, name: 'Gym' }, memberPlan: { id: 3, name: 'Three Months', price: 3000, duration: 3, planDuration: { id: 1, name: '3 Months', value: 3 } }, payments: [{ id: 8, status: PaymentStatus.DRAFT, amount: 3000, requestDate: new Date('2026-10-10T00:00:00.000Z'), hasProof: true }] };
const identity = (permissionNames = permissions): AdminIdentityRepository => ({ findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Admin', roleNames: [], permissionNames })) });
const repository = (): MembershipRequestRepository => ({ findPage: vi.fn(async () => ({ records: [record], total: 1 })), findById: vi.fn(async (id) => id === 1 ? record : null) });
const app = (repo: MembershipRequestRepository, permissionNames = permissions) => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/membership-requests', createMembershipRequestRouter({ adminIdentityRepository: identity(permissionNames), membershipRequestRepository: repo })); value.use(errorHandler); return value; };
const headers = () => ({ Authorization: `Bearer ${jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' })}` });

describe('Membership Request router', () => {
  it('enforces distinct list/read permissions and returns safe canonical-status DTOs', async () => {
    const list = await request(app(repository())).get('/api/admin/v1/membership-requests?member_name=Synthetic&member_plan_id=3&status=PENDING&date=2026-10-10&limit=1').set(headers());
    const forbidden = await request(app(repository(), ['member-request:list'])).get('/api/admin/v1/membership-requests/1').set(headers());
    const detail = await request(app(repository())).get('/api/admin/v1/membership-requests/1').set(headers());
    expect(list.status).toBe(200); expect(list.body.data[0]).toMatchObject({ status: 'PENDING', member: { clientCode: 'MR-001' }, memberPlan: { currentPrice: 3000 }, payments: [{ proofAvailable: true }] });
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
});
