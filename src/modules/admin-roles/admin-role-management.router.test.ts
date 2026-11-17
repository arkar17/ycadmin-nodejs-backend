import { Status } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { createAuthenticateAdmin } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { errorHandler } from '../../middleware/error-handler.js';
import type { RbacMutationRepository, RbacMutationTransaction } from '../admin-rbac/rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { AdminRoleDetailRecord, AdminRoleRepository } from './admin-role.repository.js';
import { createAdminRoleRouter } from './admin-role.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const now = new Date('2026-11-17T00:00:00.000Z');

type StoredRole = { id: number; name: string; description: string | null; status: Status; permissionIds: number[]; createdAt: Date; updatedAt: Date };
type StoredUser = { id: number; name: string; status: Status; roleIds: number[] };

const harness = () => {
  const permissions = new Map([
    [10, { id: 10, name: 'member:list', description: 'List members', status: Status.ACTIVE }],
    [11, { id: 11, name: 'member:read', description: 'Read members', status: Status.ACTIVE }],
    [12, { id: 12, name: 'member:delete', description: 'Delete members', status: Status.INACTIVE }],
  ]);
  const roles = new Map<number, StoredRole>([
    [1, { id: 1, name: SYSTEM_ADMIN_ROLE_NAME, description: 'Protected', status: Status.ACTIVE, permissionIds: [10], createdAt: now, updatedAt: now }],
    [2, { id: 2, name: 'Manager', description: 'Normal role', status: Status.ACTIVE, permissionIds: [10], createdAt: now, updatedAt: now }],
    [3, { id: 3, name: 'Retired', description: null, status: Status.INACTIVE, permissionIds: [], createdAt: now, updatedAt: now }],
  ]);
  const users = new Map<number, StoredUser>([
    [1, { id: 1, name: 'System Actor', status: Status.ACTIVE, roleIds: [1] }],
    [4, { id: 4, name: 'Normal Actor', status: Status.ACTIVE, roleIds: [2] }],
  ]);
  let nextRoleId = 20;
  const activeSystem = (user: StoredUser) => user.status === Status.ACTIVE && user.roleIds.some((id) => roles.get(id)?.status === Status.ACTIVE && roles.get(id)?.name === SYSTEM_ADMIN_ROLE_NAME);
  const identity: AdminIdentityRepository = {
    findActiveAdminById: vi.fn(async (id) => {
      const user = users.get(id);
      if (!user || user.status !== Status.ACTIVE) return null;
      const activeRoles = user.roleIds.flatMap((roleId) => roles.get(roleId)?.status === Status.ACTIVE ? [roles.get(roleId)!] : []);
      if (activeRoles.length === 0) return null;
      const permissionNames = [...new Set(activeRoles.flatMap((role) => role.permissionIds.flatMap((permissionId) => permissions.get(permissionId)?.status === Status.ACTIVE ? [permissions.get(permissionId)!.name] : [])))];
      return { id, displayName: user.name, roleNames: activeRoles.map((role) => role.name), permissionNames };
    }),
  };
  const transaction: RbacMutationTransaction = {
    findUser: vi.fn(async (id) => {
      const user = users.get(id);
      return user ? { id, status: user.status, isActiveSystemAdmin: activeSystem(user) } : null;
    }),
    findUserProfile: vi.fn(async () => null),
    findUserIdentityConflict: vi.fn(async () => null),
    findRole: vi.fn(async (id) => {
      const role = roles.get(id);
      return role ? { id, name: role.name, status: role.status } : null;
    }),
    findRoleProfile: vi.fn(async (id) => {
      const role = roles.get(id);
      return role ? { id, name: role.name, description: role.description, status: role.status } : null;
    }),
    findRoleNameConflict: vi.fn(async (name, excludeId) => [...roles.values()].some((role) => role.id !== excludeId && role.name === name)),
    findRoles: vi.fn(async (ids) => ids.flatMap((id) => {
      const role = roles.get(id);
      return role ? [{ id, name: role.name, status: role.status }] : [];
    })),
    findPermission: vi.fn(async (id) => permissions.get(id) ?? null),
    findPermissions: vi.fn(async (ids) => ids.flatMap((id) => permissions.get(id) ?? [])),
    countActiveSystemAdmins: vi.fn(async () => [...users.values()].filter(activeSystem).length),
    listUserRoleIds: vi.fn(async (userId) => users.get(userId)?.roleIds ?? []),
    hasUserRole: vi.fn(async (userId, roleId) => users.get(userId)?.roleIds.includes(roleId) ?? false),
    createUserRole: vi.fn(async () => false),
    deleteUserRole: vi.fn(async () => false),
    replaceUserRoles: vi.fn(async () => undefined),
    updateUserStatus: vi.fn(async () => undefined),
    createAdminUser: vi.fn(async () => 99),
    updateAdminUserProfile: vi.fn(async () => undefined),
    createAdminRole: vi.fn(async (input) => {
      const id = nextRoleId++;
      roles.set(id, { id, name: input.name, description: input.description, status: input.status, permissionIds: [...input.permissionIds], createdAt: now, updatedAt: now });
      return id;
    }),
    updateAdminRole: vi.fn(async (id, input) => { Object.assign(roles.get(id)!, input, { updatedAt: now }); }),
    updateRoleStatus: vi.fn(async (id, status) => { roles.get(id)!.status = status; }),
    listRolePermissionIds: vi.fn(async (id) => [...(roles.get(id)?.permissionIds ?? [])].sort((a, b) => a - b)),
    replaceRolePermissions: vi.fn(async (id, ids) => { roles.get(id)!.permissionIds = [...ids]; }),
    hasRolePermission: vi.fn(async (roleId, permissionId) => roles.get(roleId)?.permissionIds.includes(permissionId) ?? false),
    createRolePermission: vi.fn(async (roleId, permissionId) => {
      const role = roles.get(roleId)!;
      if (role.permissionIds.includes(permissionId)) return false;
      role.permissionIds.push(permissionId);
      return true;
    }),
    deleteRolePermission: vi.fn(async (roleId, permissionId) => {
      const role = roles.get(roleId)!;
      const before = role.permissionIds.length;
      role.permissionIds = role.permissionIds.filter((id) => id !== permissionId);
      return before !== role.permissionIds.length;
    }),
  };
  const mutationRepository: RbacMutationRepository = { executeSerializable: vi.fn(async (operation) => operation(transaction)) };
  const roleRepository: AdminRoleRepository = {
    findPage: vi.fn(async () => ({ records: [], total: 0 })),
    findById: vi.fn(async (id): Promise<AdminRoleDetailRecord | null> => {
      const role = roles.get(id);
      if (!role) return null;
      return {
        id,
        name: role.name,
        description: role.description,
        status: role.status,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
        assignedUsersCount: [...users.values()].filter((user) => user.roleIds.includes(id) && user.status === Status.ACTIVE).length,
        permissions: role.permissionIds.flatMap((permissionId) => permissions.get(permissionId) ?? []),
      };
    }),
  };
  const audit: RbacSecurityAuditSink = { record: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1/roles', createAdminRoleRouter({
    adminIdentityRepository: identity,
    adminRoleRepository: roleRepository,
    rbacMutationRepository: mutationRepository,
    rbacSecurityAuditSink: audit,
  }));
  const authenticate = createAuthenticateAdmin(identity);
  app.get('/probe/list', authenticate, requirePermission('member:list'), (_request, response) => response.json({ ok: true }));
  app.get('/probe/read', authenticate, requirePermission('member:read'), (_request, response) => response.json({ ok: true }));
  app.use(errorHandler);
  return { app, roles, users, permissions, transaction, audit };
};

const auth = (id = 1) => ({ Authorization: `Bearer ${token(id)}` });

describe('Admin role management router', () => {
  it('creates a normalized normal role with active initial permissions atomically', async () => {
    const state = harness();
    const response = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: '  Support   Manager ', description: ' Support ', permissionIds: [10, 11] });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ changed: true, role: { name: 'Support Manager', description: 'Support', isSystemRole: false } });
    expect(response.body.data.role.permissions.map((permission: { id: number }) => permission.id).sort()).toEqual([10, 11]);
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.role.create', actorUserId: 1, beforeIds: [], afterIds: [10, 11], outcome: 'changed' }));
  });

  it('denies normal actors and rejects protected/duplicate role names', async () => {
    const denied = await request(harness().app).post('/api/admin/v1/roles').set(auth(4)).send({ name: 'Support' });
    expect(denied.status).toBe(403);
    const state = harness();
    const protectedRole = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: SYSTEM_ADMIN_ROLE_NAME });
    const duplicate = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: 'Manager' });
    expect([protectedRole.status, duplicate.status]).toEqual([409, 409]);
  });

  it('rejects missing, inactive, and duplicate initial permissions without creating a role', async () => {
    const state = harness();
    const missing = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: 'Missing', permissionIds: [999] });
    const inactive = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: 'Inactive', permissionIds: [12] });
    const duplicates = await request(state.app).post('/api/admin/v1/roles').set(auth()).send({ name: 'Duplicates', permissionIds: [10, 10] });
    expect([missing.status, inactive.status, duplicates.status]).toEqual([404, 409, 422]);
    expect(state.transaction.createAdminRole).not.toHaveBeenCalled();
  });

  it('updates only safe normal-role fields and protects both directions of the System Admin name', async () => {
    const state = harness();
    const updated = await request(state.app).patch('/api/admin/v1/roles/2').set(auth()).send({ name: ' Operations   Manager ', description: null });
    expect(updated.status).toBe(200);
    expect(updated.body.data.role).toMatchObject({ name: 'Operations Manager', description: null });
    const system = await request(state.app).patch('/api/admin/v1/roles/1').set(auth()).send({ name: 'Renamed' });
    const toSystem = await request(state.app).patch('/api/admin/v1/roles/2').set(auth()).send({ name: SYSTEM_ADMIN_ROLE_NAME });
    const unknown = await request(state.app).patch('/api/admin/v1/roles/2').set(auth()).send({ permissionIds: [11] });
    const denied = await request(state.app).patch('/api/admin/v1/roles/2').set(auth(4)).send({ name: 'Denied' });
    expect([system.status, toSystem.status, unknown.status, denied.status]).toEqual([409, 409, 422, 403]);
  });

  it('retires assigned normal roles idempotently and revokes/restores access on the next request', async () => {
    const state = harness();
    expect((await request(state.app).get('/probe/list').set(auth(4))).status).toBe(200);
    const retired = await request(state.app).post('/api/admin/v1/roles/2/deactivate').set(auth());
    const retiredAgain = await request(state.app).post('/api/admin/v1/roles/2/deactivate').set(auth());
    expect([retired.body.data.changed, retiredAgain.body.data.changed]).toEqual([true, false]);
    expect((await request(state.app).get('/probe/list').set(auth(4))).status).toBe(401);
    const activated = await request(state.app).post('/api/admin/v1/roles/2/activate').set(auth());
    expect(activated.body.data.changed).toBe(true);
    expect((await request(state.app).get('/probe/list').set(auth(4))).status).toBe(200);
    const protectedRole = await request(state.app).post('/api/admin/v1/roles/1/deactivate').set(auth());
    expect(protectedRole.status).toBe(409);
  });

  it('assigns active permissions idempotently and takes effect on the next request', async () => {
    const state = harness();
    expect((await request(state.app).get('/probe/read').set(auth(4))).status).toBe(403);
    const assigned = await request(state.app).post('/api/admin/v1/roles/2/permissions/11').set(auth());
    const duplicate = await request(state.app).post('/api/admin/v1/roles/2/permissions/11').set(auth());
    const inactive = await request(state.app).post('/api/admin/v1/roles/2/permissions/12').set(auth());
    const missing = await request(state.app).post('/api/admin/v1/roles/2/permissions/999').set(auth());
    const denied = await request(state.app).post('/api/admin/v1/roles/2/permissions/11').set(auth(4));
    expect([assigned.status, duplicate.status, inactive.status, missing.status, denied.status]).toEqual([200, 200, 409, 404, 403]);
    expect([assigned.body.data.changed, duplicate.body.data.changed]).toEqual([true, false]);
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'admin.permission.assign',
      targetId: 2,
      permissionId: 11,
      beforeIds: [],
      afterIds: [11],
    }));
    expect((await request(state.app).get('/probe/read').set(auth(4))).status).toBe(200);
  });

  it('removes permissions and revokes access on the next request with deterministic missing handling', async () => {
    const state = harness();
    const removed = await request(state.app).delete('/api/admin/v1/roles/2/permissions/10').set(auth());
    expect(removed.status).toBe(200);
    expect((await request(state.app).get('/probe/list').set(auth(4))).status).toBe(403);
    const missing = await request(state.app).delete('/api/admin/v1/roles/2/permissions/10').set(auth());
    const denied = await request(state.app).delete('/api/admin/v1/roles/2/permissions/11').set(auth(4));
    expect([missing.status, denied.status]).toEqual([404, 403]);
  });

  it('atomically replaces or clears complete permission sets and emits before/after audit IDs', async () => {
    const state = harness();
    const replaced = await request(state.app).put('/api/admin/v1/roles/2/permissions').set(auth()).send({ permissionIds: [11] });
    expect(replaced.status).toBe(200);
    expect(state.roles.get(2)!.permissionIds).toEqual([11]);
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.permissions.replace', beforeIds: [10], afterIds: [11], outcome: 'changed' }));
    const before = [...state.roles.get(2)!.permissionIds];
    const duplicate = await request(state.app).put('/api/admin/v1/roles/2/permissions').set(auth()).send({ permissionIds: [11, 11] });
    const missing = await request(state.app).put('/api/admin/v1/roles/2/permissions').set(auth()).send({ permissionIds: [999] });
    const inactive = await request(state.app).put('/api/admin/v1/roles/2/permissions').set(auth()).send({ permissionIds: [12] });
    expect([duplicate.status, missing.status, inactive.status]).toEqual([422, 404, 409]);
    expect(state.roles.get(2)!.permissionIds).toEqual(before);
    const cleared = await request(state.app).put('/api/admin/v1/roles/2/permissions').set(auth()).send({ permissionIds: [] });
    expect(cleared.status).toBe(200);
    expect(state.roles.get(2)!.permissionIds).toEqual([]);
  });

  it('rejects every public permission mutation against the protected System Admin role', async () => {
    const state = harness();
    const assigned = await request(state.app).post('/api/admin/v1/roles/1/permissions/11').set(auth());
    const removed = await request(state.app).delete('/api/admin/v1/roles/1/permissions/10').set(auth());
    const replaced = await request(state.app).put('/api/admin/v1/roles/1/permissions').set(auth()).send({ permissionIds: [11] });
    expect([assigned.status, removed.status, replaced.status]).toEqual([409, 409, 409]);
    expect(state.roles.get(1)!.permissionIds).toEqual([10]);
  });
});
