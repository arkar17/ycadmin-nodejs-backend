import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { disconnectDatabase, getPrismaClient } from '../../database/prisma.js';
import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { assertIsolatedIntegrationDatabaseUrl } from '../../tests/integration-database-safety.js';
import { SYSTEM_ADMIN_ROLE_NAME } from './admin-access-policy.js';
import { PrismaAdminIdentityRepository } from './admin-identity.repository.js';

/**
 * Approved policy, exercised end to end against PostgreSQL:
 *   authentication = ACTIVE User + at least one ACTIVE Role (permissions irrelevant)
 *   authorization  = ACTIVE permissions from ACTIVE roles, or an ACTIVE exact SuperAdmin role
 */
const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const bearer = (id: number) => `Bearer ${jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' })}`;

const app = () => {
  const value = express();
  const authenticate = createAuthenticateAdmin(new PrismaAdminIdentityRepository());
  value.get('/whoami', authenticate, (req, res) => { res.json(req.auth); });
  value.get('/protected', authenticate, requirePermission('member:list'), (_req, res) => { res.json({ ok: true }); });
  value.use(errorHandler);
  return value;
};

let sequence = 0;
const createUser = async (status: Status = Status.ACTIVE) => {
  sequence += 1;
  return getPrismaClient().user.create({
    data: {
      name: `Synthetic Policy Admin ${sequence}`,
      email: `synthetic.policy.${sequence}@example.test`,
      username: `synthetic-policy-${sequence}`,
      password: 'synthetic-only-password-hash',
      status,
    },
  });
};
const createRole = (name: string, status: Status = Status.ACTIVE) => getPrismaClient().role.create({ data: { name, status } });
const assign = (userId: number, roleId: number) => getPrismaClient().userRole.create({ data: { userId, roleId } });

describe('Admin identity authentication vs authorization (isolated PostgreSQL)', () => {
  let memberList: { id: number };

  beforeAll(() => {
    assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
  });

  beforeEach(async () => {
    assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
    const prisma = getPrismaClient();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "RolePermission", "UserRole", "Permission", "Role", "User" RESTART IDENTITY CASCADE');
    memberList = await prisma.permission.create({ data: { name: 'member:list', description: 'Synthetic test permission' } });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('1. ACTIVE User + ACTIVE Role + required permission is allowed', async () => {
    const user = await createUser();
    const role = await createRole('Synthetic Directory Role');
    await getPrismaClient().rolePermission.create({ data: { roleId: role.id, permissionId: memberList.id } });
    await assign(user.id, role.id);

    const response = await request(app()).get('/protected').set('Authorization', bearer(user.id));
    expect(response.status).toBe(200);
  });

  it('2. ACTIVE Role with zero permissions authenticates (role kept, no permissions) and is forbidden', async () => {
    const user = await createUser();
    const role = await createRole('Synthetic Zero Permission Role');
    await assign(user.id, role.id);

    const identity = await request(app()).get('/whoami').set('Authorization', bearer(user.id));
    const protectedResponse = await request(app()).get('/protected').set('Authorization', bearer(user.id));

    expect(identity.status).toBe(200);
    expect(identity.body).toMatchObject({ userId: user.id, roles: ['Synthetic Zero Permission Role'], permissions: [], isSystemAdmin: false });
    expect(protectedResponse.status).toBe(403);
  });

  it('3. removing the required permission yields 403 on the next request, not 401', async () => {
    const prisma = getPrismaClient();
    const user = await createUser();
    const role = await createRole('Synthetic Revoked Role');
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: memberList.id } });
    await assign(user.id, role.id);
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(200);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(403);

    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: memberList.id } });
    await prisma.permission.update({ where: { id: memberList.id }, data: { status: Status.INACTIVE } });
    const inactivePermission = await request(app()).get('/whoami').set('Authorization', bearer(user.id));
    expect(inactivePermission.body).toMatchObject({ roles: ['Synthetic Revoked Role'], permissions: [] });
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(403);
  });

  it('4. ACTIVE User whose only Role is INACTIVE is unauthenticated, even if that role holds the permission', async () => {
    const user = await createUser();
    const role = await createRole('Synthetic Inactive Role', Status.INACTIVE);
    await getPrismaClient().rolePermission.create({ data: { roleId: role.id, permissionId: memberList.id } });
    await assign(user.id, role.id);

    expect((await request(app()).get('/whoami').set('Authorization', bearer(user.id))).status).toBe(401);
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(401);
  });

  it('5. ACTIVE User with no Role is unauthenticated', async () => {
    const user = await createUser();
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(401);
  });

  it('6. INACTIVE User is unauthenticated even with an ACTIVE permitted Role', async () => {
    const user = await createUser(Status.INACTIVE);
    const role = await createRole('Synthetic Directory Role');
    await getPrismaClient().rolePermission.create({ data: { roleId: role.id, permissionId: memberList.id } });
    await assign(user.id, role.id);

    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(401);
  });

  it('7. ACTIVE SuperAdmin role with zero permission rows keeps the System Admin bypass', async () => {
    const user = await createUser();
    const role = await createRole(SYSTEM_ADMIN_ROLE_NAME);
    await assign(user.id, role.id);

    const identity = await request(app()).get('/whoami').set('Authorization', bearer(user.id));
    expect(identity.body).toMatchObject({ roles: ['SuperAdmin'], permissions: [], isSystemAdmin: true });
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(200);
  });

  it('8. an INACTIVE SuperAdmin role grants no bypass; permissions come only from ACTIVE roles and are deduplicated', async () => {
    const prisma = getPrismaClient();
    const user = await createUser();
    const superAdmin = await createRole(SYSTEM_ADMIN_ROLE_NAME, Status.INACTIVE);
    const inactiveGranting = await createRole('Synthetic Inactive Granting Role', Status.INACTIVE);
    const activeA = await createRole('Synthetic Active Role A');
    const activeB = await createRole('Synthetic Active Role B');
    const other = await prisma.permission.create({ data: { name: 'member:read', description: 'Synthetic test permission' } });
    await prisma.rolePermission.create({ data: { roleId: inactiveGranting.id, permissionId: memberList.id } });
    await prisma.rolePermission.create({ data: { roleId: activeA.id, permissionId: other.id } });
    await prisma.rolePermission.create({ data: { roleId: activeB.id, permissionId: other.id } });
    for (const role of [superAdmin, inactiveGranting, activeA, activeB]) await assign(user.id, role.id);

    const identity = await request(app()).get('/whoami').set('Authorization', bearer(user.id));
    expect(identity.status).toBe(200);
    expect(identity.body.isSystemAdmin).toBe(false);
    expect([...identity.body.roles].sort()).toEqual(['Synthetic Active Role A', 'Synthetic Active Role B']);
    expect(identity.body.permissions).toEqual(['member:read']);
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(403);

    // With only the inactive SuperAdmin role, the user is not authenticated at all.
    await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: { in: [activeA.id, activeB.id, inactiveGranting.id] } } });
    expect((await request(app()).get('/protected').set('Authorization', bearer(user.id))).status).toBe(401);
  });
});
