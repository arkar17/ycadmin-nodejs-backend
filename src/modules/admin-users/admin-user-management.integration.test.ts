import { Status } from '@prisma/client';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { assertIsolatedIntegrationDatabaseUrl } from '../../tests/integration-database-safety.js';
import { PrismaRbacMutationRepository } from '../admin-rbac/rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { PrismaAdminUserRepository } from './admin-user.repository.js';
import { createAdminUserRouter } from './admin-user.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });

type Fixture = {
  firstSystemId: number;
  secondSystemId: number;
  normalUserId: number;
  systemRoleId: number;
  normalRoleId: number;
  inactiveRoleId: number;
};

const audit: RbacSecurityAuditSink = { record: vi.fn() };
const app = () => {
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/users', createAdminUserRouter({
    adminIdentityRepository: new PrismaAdminIdentityRepository(),
    adminUserRepository: new PrismaAdminUserRepository(),
    rbacMutationRepository: new PrismaRbacMutationRepository(),
    rbacSecurityAuditSink: audit,
  }));
  value.use(errorHandler);
  return value;
};

const reset = async (): Promise<Fixture> => {
  assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );
  const [systemRole, normalRole, inactiveRole] = await Promise.all([
    prisma.role.create({ data: { name: SYSTEM_ADMIN_ROLE_NAME } }),
    prisma.role.create({ data: { name: 'Integration Manager' } }),
    prisma.role.create({ data: { name: 'Integration Archived', status: Status.INACTIVE } }),
  ]);
  const [firstSystem, secondSystem, normalUser] = await Promise.all([
    prisma.user.create({ data: { name: 'System A', email: 'system-a@example.test', username: 'system-a', password: 'hash' } }),
    prisma.user.create({ data: { name: 'System B', email: 'system-b@example.test', username: 'system-b', password: 'hash' } }),
    prisma.user.create({ data: { name: 'Normal Admin', email: 'normal-admin@example.test', username: 'normal-admin', password: 'hash' } }),
  ]);
  await prisma.userRole.createMany({ data: [
    { userId: firstSystem.id, roleId: systemRole.id },
    { userId: secondSystem.id, roleId: systemRole.id },
    { userId: normalUser.id, roleId: normalRole.id },
  ] });
  return {
    firstSystemId: firstSystem.id,
    secondSystemId: secondSystem.id,
    normalUserId: normalUser.id,
    systemRoleId: systemRole.id,
    normalRoleId: normalRole.id,
    inactiveRoleId: inactiveRole.id,
  };
};

describe('Admin account public mutation paths on isolated PostgreSQL', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    vi.mocked(audit.record).mockClear();
    fixture = await reset();
  });

  afterEach(async () => {
    assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
    await getPrismaClient().$executeRawUnsafe(
      'TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => { await disconnectDatabase(); });

  it('creates a User and initial roles atomically with a bcrypt hash and safe response', async () => {
    const response = await request(app()).post('/api/admin/v1/users')
      .set('Authorization', `Bearer ${token(fixture.firstSystemId)}`)
      .send({
        name: 'Integration Created',
        email: 'INTEGRATION.CREATED@EXAMPLE.TEST',
        username: 'Integration.Created',
        password: 'Strong1!',
        passwordConfirm: 'Strong1!',
        roleIds: [fixture.normalRoleId],
      });
    expect(response.status).toBe(201);
    expect(JSON.stringify(response.body)).not.toMatch(/Strong1|password|hash/i);
    const stored = await getPrismaClient().user.findUniqueOrThrow({
      where: { id: response.body.data.user.id },
      include: { roles: true },
    });
    expect(stored).toMatchObject({
      email: 'integration.created@example.test',
      username: 'integration.created',
      createdById: fixture.firstSystemId,
    });
    expect(await bcrypt.compare('Strong1!', stored.password)).toBe(true);
    expect(stored.roles.map(({ roleId }) => roleId)).toEqual([fixture.normalRoleId]);

    const before = await getPrismaClient().user.count();
    const rejected = await request(app()).post('/api/admin/v1/users')
      .set('Authorization', `Bearer ${token(fixture.firstSystemId)}`)
      .send({
        name: 'Must Roll Back',
        email: 'rollback@example.test',
        username: 'rollback',
        password: 'Strong1!',
        passwordConfirm: 'Strong1!',
        roleIds: [fixture.inactiveRoleId],
      });
    expect(rejected.status).toBe(409);
    expect(await getPrismaClient().user.count()).toBe(before);
  });

  it('activates/deactivates through the public path and writes existing audit actor fields', async () => {
    const value = app();
    const authorization = `Bearer ${token(fixture.firstSystemId)}`;
    const deactivated = await request(value).post(`/api/admin/v1/users/${fixture.normalUserId}/deactivate`).set('Authorization', authorization);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data).toMatchObject({ changed: true, user: { status: 'INACTIVE' } });
    expect(await getPrismaClient().user.findUniqueOrThrow({ where: { id: fixture.normalUserId }, select: { updatedById: true } })).toEqual({ updatedById: fixture.firstSystemId });
    const again = await request(value).post(`/api/admin/v1/users/${fixture.normalUserId}/deactivate`).set('Authorization', authorization);
    expect(again.body.data.changed).toBe(false);
    const activated = await request(value).post(`/api/admin/v1/users/${fixture.normalUserId}/activate`).set('Authorization', authorization);
    expect(activated.body.data).toMatchObject({ changed: true, user: { status: 'ACTIVE' } });
  });

  it('uses protected role-removal safety through the public path', async () => {
    const value = app();
    const authorization = `Bearer ${token(fixture.firstSystemId)}`;
    const removed = await request(value)
      .delete(`/api/admin/v1/users/${fixture.secondSystemId}/roles/${fixture.systemRoleId}`)
      .set('Authorization', authorization);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ changed: true, user: { isSystemAdmin: false } });
    const self = await request(value)
      .delete(`/api/admin/v1/users/${fixture.firstSystemId}/roles/${fixture.systemRoleId}`)
      .set('Authorization', authorization);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('SYSTEM_ADMIN_SELF_MUTATION_FORBIDDEN');
    expect(await getPrismaClient().userRole.count({ where: { roleId: fixture.systemRoleId } })).toBe(1);
  });
});
