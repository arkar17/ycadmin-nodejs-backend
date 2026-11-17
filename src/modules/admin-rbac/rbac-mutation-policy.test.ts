import { Status } from '@prisma/client';

import { SYSTEM_ADMIN_ROLE_NAME } from '../auth/admin-access-policy.js';
import {
  assertRoleCanBeHardDeleted,
  assertRoleNameCreatable,
  assertRoleUpdateAllowed,
  assertProtectedRoleMutable,
  isActiveSystemAdminMembership,
} from './rbac-mutation-policy.js';

const role = (name: string, status = Status.ACTIVE) => ({ name, status });

describe('System Admin mutation policy', () => {
  it('identifies only an active User with the active exact System Admin role', () => {
    expect(isActiveSystemAdminMembership(Status.ACTIVE, [role(SYSTEM_ADMIN_ROLE_NAME)])).toBe(true);
    expect(isActiveSystemAdminMembership(Status.ACTIVE, [role(SYSTEM_ADMIN_ROLE_NAME, Status.INACTIVE)])).toBe(false);
    expect(isActiveSystemAdminMembership(Status.INACTIVE, [role(SYSTEM_ADMIN_ROLE_NAME)])).toBe(false);
    expect(isActiveSystemAdminMembership(Status.ACTIVE, [role('Manager')])).toBe(false);
    expect(isActiveSystemAdminMembership(Status.ACTIVE, [role('superadmin')])).toBe(false);
  });

  it.each(['rename', 'deactivate', 'delete'] as const)(
    'prevents protected System Admin role %s through ordinary role mutation policy',
    (mutation) => {
      expect(() => assertProtectedRoleMutable(SYSTEM_ADMIN_ROLE_NAME, mutation)).toThrowError(
        expect.objectContaining({ code: 'SYSTEM_ROLE_PROTECTED' }),
      );
      expect(() => assertProtectedRoleMutable('Manager', mutation)).not.toThrow();
    },
  );

  it('rejects recreating the special role name and hard-deleting assigned normal roles', () => {
    expect(() => assertRoleNameCreatable(SYSTEM_ADMIN_ROLE_NAME)).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_ROLE_PROTECTED' }),
    );
    expect(() => assertRoleCanBeHardDeleted('Manager', 1)).toThrowError(
      expect.objectContaining({ code: 'ROLE_IN_USE' }),
    );
    expect(() => assertRoleCanBeHardDeleted('Manager', 0)).not.toThrow();
    expect(() => assertRoleUpdateAllowed('Manager', SYSTEM_ADMIN_ROLE_NAME)).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_ROLE_PROTECTED' }),
    );
    expect(() => assertRoleUpdateAllowed(SYSTEM_ADMIN_ROLE_NAME, 'Manager')).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_ROLE_PROTECTED' }),
    );
  });
});
