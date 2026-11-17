import { Prisma, Status } from '@prisma/client';

import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import type { RbacMutationTransaction } from './rbac-mutation.repository.js';
import type { RbacSecurityAuditSink } from './rbac-security-audit.js';
import { RbacMutationService } from './rbac-mutation.service.js';
import { runWithSerializableRetry } from './serializable-transaction.js';

const context = { requestId: 'request-123', actorUserId: 1 };
const systemRole = { id: 10, name: SYSTEM_ADMIN_ROLE_NAME, status: Status.ACTIVE };
const normalRole = { id: 11, name: 'Manager', status: Status.ACTIVE };
const permission = { id: 20, name: 'member:list', status: Status.ACTIVE };
const activeSystemUser = (id: number) => ({ id, status: Status.ACTIVE, isActiveSystemAdmin: true });
const activeNormalUser = (id: number) => ({ id, status: Status.ACTIVE, isActiveSystemAdmin: false });

const transaction = (): RbacMutationTransaction => ({
  findUser: vi.fn(async (id) => id === 1 ? activeSystemUser(1) : activeSystemUser(id)),
  findRole: vi.fn(async (id) => id === systemRole.id ? systemRole : normalRole),
  findRoles: vi.fn(async (ids) => ids.map((id) => id === systemRole.id ? systemRole : normalRole)),
  findPermission: vi.fn(async () => permission),
  countActiveSystemAdmins: vi.fn(async () => 2),
  listUserRoleIds: vi.fn(async () => [systemRole.id]),
  hasUserRole: vi.fn(async () => true),
  createUserRole: vi.fn(async () => true),
  deleteUserRole: vi.fn(async () => true),
  replaceUserRoles: vi.fn(async () => undefined),
  updateUserStatus: vi.fn(async () => undefined),
  hasRolePermission: vi.fn(async () => false),
  createRolePermission: vi.fn(async () => true),
  deleteRolePermission: vi.fn(async () => true),
});

const setup = (tx = transaction()) => {
  const audit: RbacSecurityAuditSink = { record: vi.fn() };
  const repository = { executeSerializable: vi.fn(async (operation) => operation(tx)) };
  return { tx, audit, repository, service: new RbacMutationService(repository, audit) };
};

describe('RBAC mutation safety service', () => {
  it('prevents removing the final active System Admin', async () => {
    const state = setup();
    vi.mocked(state.tx.countActiveSystemAdmins).mockResolvedValue(1);
    await expect(state.service.removeRole(context, 2, systemRole.id)).rejects.toMatchObject({ code: 'LAST_SYSTEM_ADMIN_REQUIRED' });
    expect(state.tx.deleteUserRole).not.toHaveBeenCalled();
  });

  it('permits removing System Admin membership when another active System Admin remains', async () => {
    const state = setup();
    await expect(state.service.removeRole(context, 2, systemRole.id)).resolves.toEqual({ changed: true });
    expect(state.tx.deleteUserRole).toHaveBeenCalledWith(2, systemRole.id);
  });

  it('prevents final System Admin deactivation and permits it when another remains', async () => {
    const blocked = setup();
    vi.mocked(blocked.tx.countActiveSystemAdmins).mockResolvedValue(1);
    await expect(blocked.service.deactivateUser(context, 2)).rejects.toMatchObject({ code: 'LAST_SYSTEM_ADMIN_REQUIRED' });
    expect(blocked.tx.updateUserStatus).not.toHaveBeenCalled();

    const allowed = setup();
    await expect(allowed.service.deactivateUser(context, 2)).resolves.toEqual({ changed: true });
    expect(allowed.tx.updateUserStatus).toHaveBeenCalledWith(2, Status.INACTIVE, 1);
  });

  it('prevents a normal Admin from deactivating a System Admin', async () => {
    const state = setup();
    vi.mocked(state.tx.findUser).mockImplementation(async (id) => id === 1 ? activeNormalUser(1) : activeSystemUser(id));
    await expect(state.service.deactivateUser(context, 2)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_REQUIRED' });
    expect(state.tx.updateUserStatus).not.toHaveBeenCalled();
  });

  it('treats an already inactive User deactivation as an idempotent no-op', async () => {
    const state = setup();
    vi.mocked(state.tx.findUser).mockImplementation(async (id) => id === 1
      ? activeSystemUser(1)
      : { id: 2, status: Status.INACTIVE, isActiveSystemAdmin: false });
    await expect(state.service.deactivateUser(context, 2)).resolves.toEqual({ changed: false });
    expect(state.tx.updateUserStatus).not.toHaveBeenCalled();
  });

  it('prevents a normal Admin from assigning or removing System Admin', async () => {
    const state = setup();
    vi.mocked(state.tx.findUser).mockImplementation(async (id) => id === 1 ? activeNormalUser(1) : activeSystemUser(id));
    vi.mocked(state.tx.hasUserRole).mockResolvedValue(false);
    await expect(state.service.assignRole(context, 2, systemRole.id)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_REQUIRED' });
    vi.mocked(state.tx.hasUserRole).mockResolvedValue(true);
    await expect(state.service.removeRole(context, 2, systemRole.id)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_REQUIRED' });
  });

  it('permits a current System Admin to assign System Admin membership', async () => {
    const state = setup();
    vi.mocked(state.tx.hasUserRole).mockResolvedValue(false);
    await expect(state.service.assignRole(context, 2, systemRole.id)).resolves.toEqual({ changed: true });
    expect(state.tx.createUserRole).toHaveBeenCalledWith(2, systemRole.id);
  });

  it('rejects inactive roles before assignment', async () => {
    const state = setup();
    vi.mocked(state.tx.findRole).mockResolvedValue({ ...normalRole, status: Status.INACTIVE });
    await expect(state.service.assignRole(context, 2, normalRole.id)).rejects.toMatchObject({ code: 'ROLE_INACTIVE' });
    expect(state.tx.createUserRole).not.toHaveBeenCalled();
  });

  it('handles duplicate role assignment as an idempotent no-op', async () => {
    const state = setup();
    await expect(state.service.assignRole(context, 2, normalRole.id)).resolves.toEqual({ changed: false });
    expect(state.tx.createUserRole).not.toHaveBeenCalled();
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no_change' }));
  });

  it('rejects inactive permissions and handles duplicate active assignments safely', async () => {
    const inactive = setup();
    vi.mocked(inactive.tx.findPermission).mockResolvedValue({ ...permission, status: Status.INACTIVE });
    await expect(inactive.service.assignPermission(context, normalRole.id, permission.id)).rejects.toMatchObject({ code: 'PERMISSION_INACTIVE' });

    const duplicate = setup();
    vi.mocked(duplicate.tx.hasRolePermission).mockResolvedValue(true);
    await expect(duplicate.service.assignPermission(context, normalRole.id, permission.id)).resolves.toEqual({ changed: false });
    expect(duplicate.tx.createRolePermission).not.toHaveBeenCalled();
  });

  it('prevents a normal Admin from changing permission rows on the protected System Admin role', async () => {
    const state = setup();
    vi.mocked(state.tx.findRole).mockResolvedValue(systemRole);
    vi.mocked(state.tx.findUser).mockResolvedValue(activeNormalUser(1));
    await expect(state.service.assignPermission(context, systemRole.id, permission.id)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_REQUIRED' });
    expect(state.tx.createRolePermission).not.toHaveBeenCalled();
  });

  it('prohibits System Admin self-removal and self-deactivation', async () => {
    const removal = setup();
    await expect(removal.service.removeRole(context, 1, systemRole.id)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_SELF_MUTATION_FORBIDDEN' });

    const deactivation = setup();
    await expect(deactivation.service.deactivateUser(context, 1)).rejects.toMatchObject({ code: 'SYSTEM_ADMIN_SELF_MUTATION_FORBIDDEN' });
  });

  it('validates a complete role replacement before deleting existing assignments', async () => {
    const duplicates = setup();
    await expect(duplicates.service.replaceUserRoles(context, 2, [normalRole.id, normalRole.id])).rejects.toMatchObject({ code: 'DUPLICATE_ROLE_ID' });
    expect(duplicates.tx.replaceUserRoles).not.toHaveBeenCalled();

    const missing = setup();
    vi.mocked(missing.tx.findRoles).mockResolvedValue([]);
    await expect(missing.service.replaceUserRoles(context, 2, [normalRole.id])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(missing.tx.replaceUserRoles).not.toHaveBeenCalled();
  });

  it('records structured outcomes without credential material', async () => {
    const state = setup();
    vi.mocked(state.tx.hasUserRole).mockResolvedValue(false);
    await state.service.assignRole(context, 2, normalRole.id);
    expect(state.audit.record).toHaveBeenCalledWith({
      requestId: 'request-123',
      actorUserId: 1,
      action: 'admin.role.assign',
      targetType: 'UserRole',
      targetId: 2,
      beforeIds: [],
      afterIds: [normalRole.id],
      outcome: 'changed',
    });
    expect(JSON.stringify(vi.mocked(state.audit.record).mock.calls)).not.toMatch(/password|jwt|token|secret/i);
  });

  it('records rejected safety decisions by stable reason code', async () => {
    const state = setup();
    vi.mocked(state.tx.findRole).mockResolvedValue({ ...normalRole, status: Status.INACTIVE });
    await expect(state.service.assignRole(context, 2, normalRole.id)).rejects.toMatchObject({ code: 'ROLE_INACTIVE' });
    expect(state.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-123',
      actorUserId: 1,
      outcome: 'rejected',
      reasonCode: 'ROLE_INACTIVE',
    }));
  });
});

describe('serializable transaction conflict handling', () => {
  it('retries a PostgreSQL/Prisma write conflict and returns the successful atomic result', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: '7.3.0',
    });
    const operation = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce('committed');

    await expect(runWithSerializableRetry(operation, 3)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated failures and stops after the configured conflict limit', async () => {
    const ordinary = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(runWithSerializableRetry(ordinary, 3)).rejects.toThrow('database unavailable');
    expect(ordinary).toHaveBeenCalledTimes(1);

    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: '7.3.0',
    });
    const exhausted = vi.fn().mockRejectedValue(conflict);
    await expect(runWithSerializableRetry(exhausted, 2)).rejects.toBe(conflict);
    expect(exhausted).toHaveBeenCalledTimes(2);
  });

  it('retries the PostgreSQL adapter error shape emitted for SQLSTATE 40001', async () => {
    const adapterConflict = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: {
        kind: 'TransactionWriteConflict',
        originalCode: '40001',
        originalMessage: 'could not serialize access due to read/write dependencies among transactions',
      },
    });
    const operation = vi.fn()
      .mockRejectedValueOnce(adapterConflict)
      .mockResolvedValueOnce('retried');
    const onRetry = vi.fn();

    await expect(runWithSerializableRetry(operation, 3, onRetry)).resolves.toBe('retried');
    expect(onRetry).toHaveBeenCalledWith(1, adapterConflict);
  });
});
