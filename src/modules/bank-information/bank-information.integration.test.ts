import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PaymentTypes, Status } from '@prisma/client';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PrismaBankInformationRepository } from './bank-information.repository.js';
import { createBankInformationRouter } from './bank-information.router.js';

const signingSecret = 'test-only-secret-with-at-least-thirty-two-characters';
const permissions = ['bank-information:list', 'bank-information:read', 'bank-information:create', 'bank-information:update', 'bank-information:delete'];
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, signingSecret, { algorithm: 'HS256', expiresIn: '1h' });
const createIntegrationApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1/bank-information', createBankInformationRouter({ adminIdentityRepository: new PrismaAdminIdentityRepository(), bankInformationRepository: new PrismaBankInformationRepository() }));
  app.use(errorHandler);
  return app;
};

const assertIsolatedDatabase = (): void => {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || databaseUrl.pathname !== '/yc_fitness_admin_integration') throw new Error('Integration tests may run only against the dedicated localhost integration database.');
};

type Fixture = { adminId: number; inactiveAdminId: number; roleId: number; createPermissionId: number; activeId: number; referencedId: number };
const resetAndSeed = async (): Promise<Fixture> => {
  assertIsolatedDatabase();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Payment", "BankInformation", "RolePermission", "UserRole", "Member", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
  const createdPermissions = await Promise.all(permissions.map((name) => prisma.permission.create({ data: { name, description: `Synthetic ${name} permission` } })));
  const role = await prisma.role.create({ data: { name: 'Synthetic Bank Role', description: 'Synthetic integration-test role' } });
  await prisma.rolePermission.createMany({ data: createdPermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) });
  const admin = await prisma.user.create({ data: { name: 'Synthetic Bank Admin', email: 'bank.admin@example.test', username: 'bank-admin', password: 'synthetic-password-hash' } });
  const inactive = await prisma.user.create({ data: { name: 'Synthetic Inactive Bank Admin', email: 'bank.inactive@example.test', username: 'bank-inactive-admin', password: 'synthetic-password-hash', status: Status.INACTIVE } });
  await prisma.userRole.createMany({ data: [{ userId: admin.id, roleId: role.id }, { userId: inactive.id, roleId: role.id }] });
  const active = await prisma.bankInformation.create({ data: { name: 'Yangon Synthetic Bank', bankAccountHolder: 'Synthetic Holder', bankAccountNumber: '1111222233334444', phone: '09111111111', paymentTypes: PaymentTypes.BANK_ACCOUNT, createdAt: new Date('2026-10-01T00:00:00.000Z') } });
  await prisma.bankInformation.create({ data: { name: 'Wallet Synthetic', bankAccountHolder: 'Wallet Holder', bankAccountNumber: '09999999999', phone: '09999999999', paymentTypes: PaymentTypes.E_WALLET, createdAt: new Date('2026-10-02T00:00:00.000Z') } });
  const referenced = await prisma.bankInformation.create({ data: { name: 'Referenced Synthetic Bank', bankAccountHolder: 'Referenced Holder', bankAccountNumber: '5555666677778888', phone: '09555555555', paymentTypes: PaymentTypes.BANK_ACCOUNT } });
  const member = await prisma.member.create({ data: { name: 'Synthetic Payment Member', code: 'BANK-001', password: 'synthetic-member-password' } });
  await prisma.payment.create({ data: { name: 'Synthetic historical payment', memberId: member.id, bankInformationId: referenced.id, attachment: 'synthetic-attachment' } });
  return { adminId: admin.id, inactiveAdminId: inactive.id, roleId: role.id, createPermissionId: createdPermissions.find((permission) => permission.name === 'bank-information:create')!.id, activeId: active.id, referencedId: referenced.id };
};

describe('Bank Information isolated PostgreSQL integration', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await resetAndSeed(); });
  afterAll(async () => { await disconnectDatabase(); });

  it('searches deterministically and masks financial account numbers in list responses', async () => {
    const response = await request(createIntegrationApp()).get('/api/admin/v1/bank-information?name=Synthetic&bank_or_phone=1111&limit=1&offset=0').set('Authorization', `Bearer ${token(fixture.adminId)}`);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ total: 1, limit: 1, offset: 0, currentPage: 1, totalPages: 1 });
    expect(response.body.data[0]).toMatchObject({ id: fixture.activeId, accountNumberMasked: '••••••••••••4444', paymentType: 'BANK_ACCOUNT' });
    expect(response.body.data[0]).not.toHaveProperty('accountNumber');
  });

  it('provides full details only on the separately authorized detail endpoint and supports unreferenced mutations', async () => {
    const app = createIntegrationApp();
    const detail = await request(app).get(`/api/admin/v1/bank-information/${fixture.activeId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`);
    const created = await request(app).post('/api/admin/v1/bank-information').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Created Wallet', paymentType: 'E_WALLET', accountNumber: '09777777777', accountHolder: 'Created Holder', phone: '09777777777' });
    const updated = await request(app).patch(`/api/admin/v1/bank-information/${fixture.activeId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Changed Synthetic Bank' });
    expect(detail.body.data.accountNumber).toBe('1111222233334444');
    expect(created.status).toBe(201);
    expect(updated.body.data.name).toBe('Changed Synthetic Bank');
  });

  it('blocks duplicates, inactive administrators, revoked permissions, and all writes to payment-referenced destinations', async () => {
    const app = createIntegrationApp();
    const duplicate = await request(app).post('/api/admin/v1/bank-information').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Duplicate', paymentType: 'BANK_ACCOUNT', accountNumber: '1111222233334444', accountHolder: 'Holder', phone: '09000000000' });
    const inactive = await request(app).get('/api/admin/v1/bank-information').set('Authorization', `Bearer ${token(fixture.inactiveAdminId)}`);
    const updateReferenced = await request(app).patch(`/api/admin/v1/bank-information/${fixture.referencedId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Unsafe' });
    const deleteReferenced = await request(app).delete(`/api/admin/v1/bank-information/${fixture.referencedId}`).set('Authorization', `Bearer ${token(fixture.adminId)}`);
    await getPrismaClient().rolePermission.deleteMany({ where: { roleId: fixture.roleId, permissionId: fixture.createPermissionId } });
    const revoked = await request(app).post('/api/admin/v1/bank-information').set('Authorization', `Bearer ${token(fixture.adminId)}`).send({ name: 'Denied', paymentType: 'BANK_ACCOUNT', accountNumber: '09888888888', accountHolder: 'Holder', phone: '09888888888' });
    expect(duplicate.status).toBe(409);
    expect(inactive.status).toBe(401);
    expect(updateReferenced.status).toBe(409);
    expect(deleteReferenced.status).toBe(409);
    expect(deleteReferenced.body.error.details).toEqual({ payments: 1 });
    expect(revoked.status).toBe(403);
  });
});
