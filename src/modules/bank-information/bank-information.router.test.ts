import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PaymentTypes, Status } from '@prisma/client';

import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { BankInformationRecord, BankInformationRepository } from './bank-information.repository.js';
import { createBankInformationRouter } from './bank-information.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['bank-information:list', 'bank-information:read', 'bank-information:create', 'bank-information:update', 'bank-information:delete'];
const record: BankInformationRecord = { id: 1, name: 'Synthetic Bank', bankAccountHolder: 'Synthetic Holder', bankAccountNumber: '1234567890', phone: '+959123456789', paymentTypes: PaymentTypes.BANK_ACCOUNT, status: Status.ACTIVE };

const identity = (permissionNames = permissions): AdminIdentityRepository => ({ findActiveAdminById: vi.fn(async () => ({ id: 1, displayName: 'Admin', roleNames: [], permissionNames })) });
const repository = (paymentCount = 0, conflicts = { accountNumber: false, phone: false }): BankInformationRepository => ({
  findPage: vi.fn(async () => ({ records: [record], total: 1 })),
  findById: vi.fn(async (id) => (id === 1 ? record : null)),
  findActiveConflict: vi.fn(async () => conflicts),
  paymentCount: vi.fn(async () => paymentCount),
  create: vi.fn(async () => record),
  update: vi.fn(async () => record),
  delete: vi.fn(async () => undefined),
});
const app = (repo: BankInformationRepository, permissionNames = permissions) => { const value = express(); value.use(express.json()); value.use('/api/admin/v1/bank-information', createBankInformationRouter({ adminIdentityRepository: identity(permissionNames), bankInformationRepository: repo })); value.use(errorHandler); return value; };
const token = () => jwt.sign({ id: 1, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token()}` };

describe('Bank Information router', () => {
  it('enforces distinct list/read permissions and masks account numbers in lists', async () => {
    const list = await request(app(repository())).get('/api/admin/v1/bank-information?name=Synthetic&bank_or_phone=1234&limit=1').set(auth);
    const detailForbidden = await request(app(repository(), ['bank-information:list'])).get('/api/admin/v1/bank-information/1').set(auth);
    const detail = await request(app(repository())).get('/api/admin/v1/bank-information/1').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: 1, paymentType: 'BANK_ACCOUNT', accountNumberMasked: '••••••7890' });
    expect(list.body.data[0]).not.toHaveProperty('accountNumber');
    expect(detailForbidden.status).toBe(403);
    expect(detail.body.data).toMatchObject({ accountNumber: '1234567890', accountHolder: 'Synthetic Holder' });
    expect(detail.body.data).not.toHaveProperty('coverPhoto');
  });

  it('validates mutations and protects conflict details without echoing account values', async () => {
    const created = await request(app(repository())).post('/api/admin/v1/bank-information').set(auth).send({ name: 'Wallet', paymentType: 'E_WALLET', accountNumber: '09123456789', accountHolder: 'Wallet Holder', phone: '09123456789' });
    const invalid = await request(app(repository())).post('/api/admin/v1/bank-information').set(auth).send({ name: 'Bad', paymentType: 'BANK_ACCOUNT', accountNumber: '', accountHolder: '', phone: '1' });
    const conflict = await request(app(repository(0, { accountNumber: true, phone: false }))).post('/api/admin/v1/bank-information').set(auth).send({ name: 'Conflict', paymentType: 'BANK_ACCOUNT', accountNumber: '999999', accountHolder: 'Holder', phone: '09111111111' });
    expect(created.status).toBe(201);
    expect(invalid.status).toBe(422);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: 'BANK_INFORMATION_CONFLICT', details: { accountNumber: true, phone: false } });
    expect(JSON.stringify(conflict.body)).not.toContain('999999');
  });

  it('does not mutate or delete payment destinations with payment history', async () => {
    const protectedRepo = repository(2);
    const updated = await request(app(protectedRepo)).patch('/api/admin/v1/bank-information/1').set(auth).send({ name: 'Changed' });
    const deleted = await request(app(protectedRepo)).delete('/api/admin/v1/bank-information/1').set(auth);
    expect(updated.status).toBe(409);
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toMatchObject({ code: 'BANK_INFORMATION_IN_USE', details: { payments: 2 } });
  });

  it('returns validation and not-found errors without exposing sensitive data', async () => {
    const malformed = await request(app(repository())).get('/api/admin/v1/bank-information?limit=101').set(auth);
    const missing = await request(app(repository())).get('/api/admin/v1/bank-information/999').set(auth);
    expect(malformed.status).toBe(422);
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).not.toContain(record.bankAccountNumber);
  });
});
