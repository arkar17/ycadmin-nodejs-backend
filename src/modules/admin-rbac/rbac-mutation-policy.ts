import { Status } from '@prisma/client';

import { AppError } from '../../shared/app-error.js';
import { isSystemAdminRoleName } from '../auth/admin-access-policy.js';

export type RbacMutationActor = { userId: number; isSystemAdmin: boolean };
export type RbacRoleState = { id: number; name: string; status: Status };
export type RbacUserState = { id: number; status: Status; isActiveSystemAdmin: boolean };
export type RbacPermissionState = { id: number; name: string; status: Status };
export type ProtectedRoleMutation = 'rename' | 'deactivate' | 'delete';

export const isActiveSystemAdminMembership = (
  userStatus: Status,
  roles: readonly Pick<RbacRoleState, 'name' | 'status'>[],
): boolean => userStatus === Status.ACTIVE
  && roles.some((role) => role.status === Status.ACTIVE && isSystemAdminRoleName(role.name));

const conflict = (code: string, message: string): AppError =>
  new AppError({ statusCode: 409, code, message });

export const requireSystemAdminActor = (actor: RbacMutationActor): void => {
  if (!actor.isSystemAdmin) {
    throw new AppError({
      statusCode: 403,
      code: 'SYSTEM_ADMIN_REQUIRED',
      message: 'A current System Admin is required for this operation.',
    });
  }
};

export const assertRoleAssignable = (role: RbacRoleState, actor: RbacMutationActor): void => {
  if (role.status !== Status.ACTIVE) {
    throw conflict('ROLE_INACTIVE', 'An inactive role cannot be assigned.');
  }
  if (isSystemAdminRoleName(role.name)) requireSystemAdminActor(actor);
};

export const assertProtectedRoleMutable = (roleName: string, _mutation: ProtectedRoleMutation): void => {
  if (isSystemAdminRoleName(roleName)) {
    throw conflict('SYSTEM_ROLE_PROTECTED', 'The System Admin role cannot be renamed, deactivated, or deleted.');
  }
};

export const assertRoleNameCreatable = (roleName: string): void => {
  if (isSystemAdminRoleName(roleName)) {
    throw conflict('SYSTEM_ROLE_PROTECTED', 'Another System Admin role cannot be created.');
  }
};

export const assertRoleUpdateAllowed = (currentRoleName: string, proposedRoleName?: string): void => {
  if (isSystemAdminRoleName(currentRoleName) || (proposedRoleName !== undefined && isSystemAdminRoleName(proposedRoleName))) {
    throw conflict('SYSTEM_ROLE_PROTECTED', 'Ordinary role updates cannot modify or create System Admin behavior.');
  }
};

export const assertRoleCanBeHardDeleted = (roleName: string, assignedUserCount: number): void => {
  assertProtectedRoleMutable(roleName, 'delete');
  if (assignedUserCount > 0) {
    throw conflict('ROLE_IN_USE', 'A role assigned to users cannot be hard-deleted. Retire it by setting it inactive.');
  }
};

export const assertProtectedRoleRelationshipActor = (roleName: string, actor: RbacMutationActor): void => {
  if (isSystemAdminRoleName(roleName)) requireSystemAdminActor(actor);
};

export const assertRoleCanBeRemovedFromUser = (
  actor: RbacMutationActor,
  targetUserId: number,
  role: RbacRoleState,
): void => {
  if (!isSystemAdminRoleName(role.name)) return;
  requireSystemAdminActor(actor);
  if (actor.userId === targetUserId) {
    throw conflict('SYSTEM_ADMIN_SELF_MUTATION_FORBIDDEN', 'System Admin self-removal is not allowed.');
  }
};

export const assertUserCanBeDeactivated = (actor: RbacMutationActor, target: RbacUserState): void => {
  if (!target.isActiveSystemAdmin) return;
  requireSystemAdminActor(actor);
  if (actor.userId === target.id) {
    throw conflict('SYSTEM_ADMIN_SELF_MUTATION_FORBIDDEN', 'System Admin self-deactivation is not allowed.');
  }
};

export const assertSystemAdminInvariant = (activeSystemAdminCountAfterMutation: number): void => {
  if (activeSystemAdminCountAfterMutation < 1) {
    throw conflict('LAST_SYSTEM_ADMIN_REQUIRED', 'The final active System Admin cannot be removed or deactivated.');
  }
};

export const assertPermissionAssignable = (permission: RbacPermissionState): void => {
  if (permission.status !== Status.ACTIVE) {
    throw conflict('PERMISSION_INACTIVE', 'An inactive permission cannot be assigned.');
  }
};

export const assertUniqueIdentifiers = (identifiers: readonly number[], kind: 'role' | 'permission'): void => {
  if (new Set(identifiers).size !== identifiers.length) {
    throw conflict(`DUPLICATE_${kind.toUpperCase()}_ID`, `Duplicate ${kind} identifiers are not allowed.`);
  }
};
