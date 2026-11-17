import { Status } from '@prisma/client';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler.js';
import type { RbacMutationRepository, RbacMutationTransaction } from '../admin-rbac/rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from '../admin-rbac/rbac-security-audit.js';
import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { AdminIdentityRepository } from '../auth/admin-identity.repository.js';
import type { AdminUserDetailRecord, AdminUserRepository } from './admin-user.repository.js';
import { createAdminUserRouter } from './admin-user.router.js';

const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const token = (id: number) => jwt.sign({ id, loginType: 'admin' }, secret, { algorithm: 'HS256', expiresIn: '1h' });
const now = new Date('2026-11-17T00:00:00.000Z');

type StoredUser = {
  id: number;
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  status: Status;
  roleIds: number[];
  createdAt: Date;
  updatedAt: Date;
};

const harness = () => {
  const roles = new Map([
    [1, { id: 1, name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE }],
    [2, { id: 2, name: 'Manager', status: Status.ACTIVE }],
    [3, { id: 3, name: 'Archived', status: Status.INACTIVE }],
  ]);
  const users = new Map<number, StoredUser>([
    [1, { id: 1, name: 'System One', email: 'system1@example.test', username: 'system1', passwordHash: 'hash', status: Status.ACTIVE, roleIds: [1], createdAt: now, updatedAt: now }],
    [2, { id: 2, name: 'Normal Admin', email: 'normal@example.test', username: 'normal', passwordHash: 'hash', status: Status.ACTIVE, roleIds: [2], createdAt: now, updatedAt: now }],
    [3, { id: 3, name: 'System Two', email: 'system2@example.test', username: 'system2', passwordHash: 'hash', status: Status.ACTIVE, roleIds: [1], createdAt: now, updatedAt: now }],
    [4, { id: 4, name: 'Ordinary Actor', email: 'ordinary@example.test', username: 'ordinary', passwordHash: 'hash', status: Status.ACTIVE, roleIds: [2], createdAt: now, updatedAt: now }],
  ]);
  let nextId = 10;
  const activeSystem = (user: StoredUser) => user.status === Status.ACTIVE && user.roleIds.some((id) => {
    const role = roles.get(id);
    return role?.status === Status.ACTIVE && role.name === SYSTEM_ADMIN_ROLE_NAME;
  });

  const transaction: RbacMutationTransaction = {
    findUser: vi.fn(async (id) => {
      const user = users.get(id);
      return user ? { id, status: user.status, isActiveSystemAdmin: activeSystem(user) } : null;
    }),
    findUserProfile: vi.fn(async (id) => {
      const user = users.get(id);
      return user ? { id, name: user.name, email: user.email, username: user.username, status: user.status } : null;
    }),
    findUserIdentityConflict: vi.fn(async (email, username, excludeUserId) => {
      const match = [...users.values()].find((user) => user.id !== excludeUserId && (user.email === email || user.username === username));
      return match ? (match.email === email ? 'email' : 'username') : null;
    }),
    findRole: vi.fn(async (id) => roles.get(id) ?? null),
    findRoles: vi.fn(async (ids) => ids.flatMap((id) => roles.get(id) ?? [])),
    findPermission: vi.fn(async () => null),
    countActiveSystemAdmins: vi.fn(async () => [...users.values()].filter(activeSystem).length),
    listUserRoleIds: vi.fn(async (userId) => [...(users.get(userId)?.roleIds ?? [])].sort((a, b) => a - b)),
    hasUserRole: vi.fn(async (userId, roleId) => users.get(userId)?.roleIds.includes(roleId) ?? false),
    createUserRole: vi.fn(async (userId, roleId) => {
      const user = users.get(userId)!;
      if (user.roleIds.includes(roleId)) return false;
      user.roleIds.push(roleId);
      return true;
    }),
    deleteUserRole: vi.fn(async (userId, roleId) => {
      const user = users.get(userId)!;
      const before = user.roleIds.length;
      user.roleIds = user.roleIds.filter((id) => id !== roleId);
      return user.roleIds.length !== before;
    }),
    replaceUserRoles: vi.fn(async (userId, roleIds) => { users.get(userId)!.roleIds = [...roleIds]; }),
    updateUserStatus: vi.fn(async (userId, status) => { users.get(userId)!.status = status; }),
    createAdminUser: vi.fn(async (input) => {
      const id = nextId++;
      users.set(id, {
        id,
        name: input.name,
        email: input.email,
        username: input.username,
        passwordHash: input.passwordHash,
        status: input.status,
        roleIds: [...input.roleIds],
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }),
    updateAdminUserProfile: vi.fn(async (userId, input) => { Object.assign(users.get(userId)!, input, { updatedAt: now }); }),
    hasRolePermission: vi.fn(async () => false),
    createRolePermission: vi.fn(async () => false),
    deleteRolePermission: vi.fn(async () => false),
  };
  const rbacMutationRepository: RbacMutationRepository = {
    executeSerializable: vi.fn(async (operation) => operation(transaction)),
  };
  const adminUserRepository: AdminUserRepository = {
    findPage: vi.fn(async () => ({ records: [], total: 0 })),
    findById: vi.fn(async (id): Promise<AdminUserDetailRecord | null> => {
      const user = users.get(id);
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        roles: user.roleIds.flatMap((roleId) => {
          const role = roles.get(roleId);
          return role ? [{ ...role, permissions: [] }] : [];
        }),
      };
    }),
  };
  const identity: AdminIdentityRepository = {
    findActiveAdminById: vi.fn(async (id) => {
      const user = users.get(id);
      if (!user || user.status !== Status.ACTIVE) return null;
      const roleNames = user.roleIds.flatMap((roleId) => roles.get(roleId)?.status === Status.ACTIVE ? [roles.get(roleId)!.name] : []);
      return { id, displayName: user.name, roleNames, permissionNames: ['user:create', 'user:update'] };
    }),
  };
  const audit: RbacSecurityAuditSink = { record: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/admin/v1/users', createAdminUserRouter({
    adminIdentityRepository: identity,
    adminUserRepository,
    rbacMutationRepository,
    rbacSecurityAuditSink: audit,
  }));
  app.use(errorHandler);
  return { app, users, roles, transaction, audit };
};

const createBody = {
  name: 'Created Admin',
  email: ' CREATED@EXAMPLE.TEST ',
  username: ' Created.Admin ',
  password: 'Strong1!',
  passwordConfirm: 'Strong1!',
  roleIds: [2],
};

describe('Admin account management router', () => {
  it('allows a System Admin to create an atomic, normalized, safely returned account with roles', async () => {
    const state = harness();
    const response = await request(state.app).post('/api/admin/v1/users').set('Authorization', `Bearer ${token(1)}`).send(createBody);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ changed: true, user: { email: 'created@example.test', username: 'created.admin', roles: [{ id: 2, name: 'Manager' }] } });
    const created = state.users.get(response.body.data.user.id)!;
    expect(await bcrypt.compare('Strong1!', created.passwordHash)).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/Strong1|password|hash/i);
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.user.create', actorUserId: 1, outcome: 'changed', afterIds: [2] }));
  });

  it('allows intentional creation of another System Admin but rejects normal actors', async () => {
    const system = harness();
    const created = await request(system.app).post('/api/admin/v1/users').set('Authorization', `Bearer ${token(1)}`).send({ ...createBody, roleIds: [1] });
    expect(created.status).toBe(201);
    expect(created.body.data.user.isSystemAdmin).toBe(true);

    const normal = harness();
    const denied = await request(normal.app).post('/api/admin/v1/users').set('Authorization', `Bearer ${token(4)}`).send(createBody);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('SYSTEM_ADMIN_REQUIRED');
  });

  it('rejects missing, inactive, duplicate, and conflicting roles/identity before creation', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    const missingRoles = await request(state.app).post('/api/admin/v1/users').set(auth).send({ ...createBody, roleIds: [] });
    const duplicateRoles = await request(state.app).post('/api/admin/v1/users').set(auth).send({ ...createBody, roleIds: [2, 2] });
    const inactiveRole = await request(state.app).post('/api/admin/v1/users').set(auth).send({ ...createBody, roleIds: [3] });
    const unknownRole = await request(state.app).post('/api/admin/v1/users').set(auth).send({ ...createBody, roleIds: [999] });
    const conflict = await request(state.app).post('/api/admin/v1/users').set(auth).send({ ...createBody, email: 'normal@example.test' });
    expect([missingRoles.status, duplicateRoles.status, inactiveRole.status, unknownRole.status, conflict.status]).toEqual([422, 422, 409, 404, 409]);
    expect(state.transaction.createAdminUser).not.toHaveBeenCalled();
  });

  it('updates only normalized profile fields and blocks password, status, and role changes', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    const updated = await request(state.app).patch('/api/admin/v1/users/2').set(auth).send({ name: ' Updated Name ', email: 'NEW@EXAMPLE.TEST' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.user).toMatchObject({ name: 'Updated Name', email: 'new@example.test' });
    for (const body of [{ password: 'Other1!' }, { status: 'INACTIVE' }, { roleIds: [1] }, { updatedById: 4 }]) {
      const prohibited = await request(state.app).patch('/api/admin/v1/users/2').set(auth).send(body);
      expect(prohibited.status).toBe(422);
    }
    const denied = await request(state.app).patch('/api/admin/v1/users/2').set('Authorization', `Bearer ${token(4)}`).send({ name: 'Denied' });
    expect(denied.status).toBe(403);
  });

  it('activates and deactivates normal Admins idempotently while denying normal actors', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    state.users.get(2)!.status = Status.INACTIVE;
    const activated = await request(state.app).post('/api/admin/v1/users/2/activate').set(auth);
    const activatedAgain = await request(state.app).post('/api/admin/v1/users/2/activate').set(auth);
    const deactivated = await request(state.app).post('/api/admin/v1/users/2/deactivate').set(auth);
    const deactivatedAgain = await request(state.app).post('/api/admin/v1/users/2/deactivate').set(auth);
    expect([activated.body.data.changed, activatedAgain.body.data.changed, deactivated.body.data.changed, deactivatedAgain.body.data.changed]).toEqual([true, false, true, false]);
    const denied = await request(state.app).post('/api/admin/v1/users/2/deactivate').set('Authorization', `Bearer ${token(4)}`);
    expect(denied.status).toBe(403);
  });

  it('enforces self-deactivation and final-System-Admin protections while allowing another System Admin', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    const self = await request(state.app).post('/api/admin/v1/users/1/deactivate').set(auth);
    expect(self.status).toBe(409);
    const other = await request(state.app).post('/api/admin/v1/users/3/deactivate').set(auth);
    expect(other.status).toBe(200);
    const final = await request(state.app).post('/api/admin/v1/users/1/deactivate').set('Authorization', `Bearer ${token(3)}`);
    expect(final.status).toBe(401);
    expect(state.users.get(1)!.status).toBe(Status.ACTIVE);
  });

  it('assigns active roles idempotently, permits protected assignment, and rejects inactive roles/normal actors', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    const assigned = await request(state.app).post('/api/admin/v1/users/2/roles/1').set(auth);
    const duplicate = await request(state.app).post('/api/admin/v1/users/2/roles/1').set(auth);
    const inactive = await request(state.app).post('/api/admin/v1/users/2/roles/3').set(auth);
    const denied = await request(state.app).post('/api/admin/v1/users/2/roles/2').set('Authorization', `Bearer ${token(4)}`);
    expect([assigned.status, duplicate.status, inactive.status, denied.status]).toEqual([200, 200, 409, 403]);
    expect([assigned.body.data.changed, duplicate.body.data.changed]).toEqual([true, false]);
    expect(assigned.body.data.user.isSystemAdmin).toBe(true);
  });

  it('removes and atomically replaces roles while preserving protected-role invariants', async () => {
    const state = harness();
    const auth = { Authorization: `Bearer ${token(1)}` };
    const removedNormal = await request(state.app).delete('/api/admin/v1/users/2/roles/2').set(auth);
    expect(removedNormal.status).toBe(200);
    const removedOtherSystem = await request(state.app).delete('/api/admin/v1/users/3/roles/1').set(auth);
    expect(removedOtherSystem.status).toBe(200);
    const self = await request(state.app).delete('/api/admin/v1/users/1/roles/1').set(auth);
    expect(self.status).toBe(409);

    state.users.get(3)!.roleIds = [1];
    const replaced = await request(state.app).put('/api/admin/v1/users/2/roles').set(auth).send({ roleIds: [2, 1] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.user.roles.map((role: { id: number }) => role.id).sort()).toEqual([1, 2]);
    const duplicate = await request(state.app).put('/api/admin/v1/users/2/roles').set(auth).send({ roleIds: [2, 2] });
    expect(duplicate.status).toBe(422);
  });

  it('does not translate repository failures into authorization errors', async () => {
    const state = harness();
    vi.mocked(state.transaction.findUserProfile).mockRejectedValueOnce(new Error('database unavailable'));
    const response = await request(state.app).patch('/api/admin/v1/users/2').set('Authorization', `Bearer ${token(1)}`).send({ name: 'Failure' });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
