import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { assertIsolatedIntegrationDatabaseUrl } from '../../tests/integration-database-safety.js';
import { PrismaRbacMutationRepository } from '../admin-rbac/rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import { PrismaAdminIdentityRepository } from '../auth/admin-identity.repository.js';
import { createAdminRoleRouter } from './admin-role.router.js';
import { PrismaAdminRoleRepository } from './admin-role.repository.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });

type Fixture = {
  systemUserId: number;
  normalUserId: number;
  systemRoleId: number;
  normalRoleId: number;
  listPermissionId: number;
  readPermissionId: number;
  inactivePermissionId: number;
};

const audit: RbacSecurityAuditSink = { record: vi.fn() };

const app = () => {
  const identity = new PrismaAdminIdentityRepository();
  const value = express();
  value.use(express.json());
  value.use('/api/admin/v1/roles', createAdminRoleRouter({
    adminIdentityRepository: identity,
    adminRoleRepository: new PrismaAdminRoleRepository(),
    rbacMutationRepository: new PrismaRbacMutationRepository(),
    rbacSecurityAuditSink: audit,
  }));
  const authenticate = createAuthenticateAdmin(identity);
  value.get('/probe/list', authenticate, requirePermission('member:list'), (_request, response) => response.json({ ok: true }));
  value.get('/probe/read', authenticate, requirePermission('member:read'), (_request, response) => response.json({ ok: true }));
  value.use(errorHandler);
  return value;
};

const reset = async (): Promise<Fixture> => {
  assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE',
  );
  const [listPermission, readPermission, inactivePermission] = await Promise.all([
    prisma.permission.create({ data: { name: 'member:list' } }),
    prisma.permission.create({ data: { name: 'member:read' } }),
    prisma.permission.create({ data: { name: 'member:delete', status: Status.INACTIVE } }),
  ]);
  const [systemRole, normalRole] = await Promise.all([
    prisma.role.create({ data: { name: SYSTEM_ADMIN_ROLE_NAME } }),
    prisma.role.create({ data: { name: 'Integration Manager' } }),
  ]);
  const [systemUser, normalUser] = await Promise.all([
    prisma.user.create({ data: { name: 'System Admin', email: 'role-system@example.test', username: 'role-system', password: 'hash' } }),
    prisma.user.create({ data: { name: 'Normal Admin', email: 'role-normal@example.test', username: 'role-normal', password: 'hash' } }),
  ]);
  await prisma.userRole.createMany({ data: [
    { userId: systemUser.id, roleId: systemRole.id },
    { userId: normalUser.id, roleId: normalRole.id },
  ] });
  await prisma.rolePermission.create({ data: { roleId: normalRole.id, permissionId: listPermission.id } });
  return {
    systemUserId: systemUser.id,
    normalUserId: normalUser.id,
    systemRoleId: systemRole.id,
    normalRoleId: normalRole.id,
    listPermissionId: listPermission.id,
    readPermissionId: readPermission.id,
    inactivePermissionId: inactivePermission.id,
  };
};

describe('Admin role management public paths on isolated PostgreSQL', () => {
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

  it('creates a role and its initial permission set atomically', async () => {
    const value = app();
    const authorization = `Bearer ${token(fixture.systemUserId)}`;
    const created = await request(value).post('/api/admin/v1/roles').set('Authorization', authorization).send({
      name: '  Integration   Support ',
      description: 'Support operators',
      permissionIds: [fixture.listPermissionId, fixture.readPermissionId],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.role).toMatchObject({ name: 'Integration Support', status: 'ACTIVE', isSystemRole: false });
    expect(created.body.data.role.permissions.map(({ id }: { id: number }) => id).sort()).toEqual([
      fixture.listPermissionId,
      fixture.readPermissionId,
    ]);

    const roleCount = await getPrismaClient().role.count();
    const rejected = await request(value).post('/api/admin/v1/roles').set('Authorization', authorization).send({
      name: 'Must Roll Back',
      permissionIds: [fixture.inactivePermissionId],
    });
    expect(rejected.status).toBe(409);
    expect(await getPrismaClient().role.count()).toBe(roleCount);
  });

  it('revokes and restores an assigned role on the next authenticated request', async () => {
    const value = app();
    const systemAuthorization = `Bearer ${token(fixture.systemUserId)}`;
    const normalAuthorization = `Bearer ${token(fixture.normalUserId)}`;
    expect((await request(value).get('/probe/list').set('Authorization', normalAuthorization)).status).toBe(200);

    const deactivated = await request(value)
      .post(`/api/admin/v1/roles/${fixture.normalRoleId}/deactivate`)
      .set('Authorization', systemAuthorization);
    expect(deactivated.body.data).toMatchObject({ changed: true, role: { status: 'INACTIVE' } });
    expect((await request(value).get('/probe/list').set('Authorization', normalAuthorization)).status).toBe(401);

    const activated = await request(value)
      .post(`/api/admin/v1/roles/${fixture.normalRoleId}/activate`)
      .set('Authorization', systemAuthorization);
    expect(activated.body.data).toMatchObject({ changed: true, role: { status: 'ACTIVE' } });
    expect((await request(value).get('/probe/list').set('Authorization', normalAuthorization)).status).toBe(200);
  });

  it('applies atomic replacement/removal immediately and protects SuperAdmin permission rows', async () => {
    const value = app();
    const systemAuthorization = `Bearer ${token(fixture.systemUserId)}`;
    const normalAuthorization = `Bearer ${token(fixture.normalUserId)}`;
    expect((await request(value).get('/probe/read').set('Authorization', normalAuthorization)).status).toBe(403);

    const replaced = await request(value)
      .put(`/api/admin/v1/roles/${fixture.normalRoleId}/permissions`)
      .set('Authorization', systemAuthorization)
      .send({ permissionIds: [fixture.readPermissionId] });
    expect(replaced.status).toBe(200);
    expect((await request(value).get('/probe/list').set('Authorization', normalAuthorization)).status).toBe(403);
    expect((await request(value).get('/probe/read').set('Authorization', normalAuthorization)).status).toBe(200);

    const rejected = await request(value)
      .put(`/api/admin/v1/roles/${fixture.normalRoleId}/permissions`)
      .set('Authorization', systemAuthorization)
      .send({ permissionIds: [fixture.listPermissionId, fixture.inactivePermissionId] });
    expect(rejected.status).toBe(409);
    expect(await getPrismaClient().rolePermission.findMany({
      where: { roleId: fixture.normalRoleId },
      select: { permissionId: true },
    })).toEqual([{ permissionId: fixture.readPermissionId }]);

    const removed = await request(value)
      .delete(`/api/admin/v1/roles/${fixture.normalRoleId}/permissions/${fixture.readPermissionId}`)
      .set('Authorization', systemAuthorization);
    expect(removed.status).toBe(200);
    expect((await request(value).get('/probe/read').set('Authorization', normalAuthorization)).status).toBe(403);

    const protectedMutation = await request(value)
      .post(`/api/admin/v1/roles/${fixture.systemRoleId}/permissions/${fixture.readPermissionId}`)
      .set('Authorization', systemAuthorization);
    expect(protectedMutation.status).toBe(409);
    expect(protectedMutation.body.error.code).toBe('SYSTEM_ROLE_PROTECTED');
    expect(await getPrismaClient().rolePermission.count({ where: { roleId: fixture.systemRoleId } })).toBe(0);
  });
});
