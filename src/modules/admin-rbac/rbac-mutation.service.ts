import { Status } from '@prisma/client';

import { AppError } from '../../shared/app-error.js';
import { isPrismaUniqueConstraintError } from '../../shared/prisma-errors.js';
import { isSystemAdminRoleName } from '../auth/admin-access-policy.js';
import {
  assertPermissionAssignable,
  assertProtectedRoleRelationshipActor,
  assertRoleAssignable,
  assertRoleCanBeRemovedFromUser,
  assertSystemAdminInvariant,
  assertUniqueIdentifiers,
  assertUserCanBeDeactivated,
  requireSystemAdminActor,
  type RbacMutationActor,
  type RbacRoleState,
} from './rbac-mutation-policy.js';
import type { RbacMutationRepository, RbacMutationTransaction } from './rbac-mutation.repository.js';
import type {
  RbacSecurityAuditEvent,
  RbacSecurityAuditOutcome,
  RbacSecurityAuditSink,
} from './rbac-security-audit.js';

export type RbacMutationContext = { requestId: string; actorUserId: number };
export type RbacMutationResult = { changed: boolean };
export type CreateAdminMutationInput = {
  name: string;
  email: string;
  username: string;
  passwordHash: string;
  status: Status;
  roleIds: readonly number[];
};
export type UpdateAdminProfileMutationInput = { name?: string; email?: string; username?: string };

type InternalMutationResult = RbacMutationResult & { beforeIds?: number[]; afterIds?: number[]; targetId?: number };
type AuditTarget = Pick<RbacSecurityAuditEvent, 'action' | 'targetType'> & { targetId?: number };

const notFound = (entity: 'User' | 'Role' | 'Permission' | 'Role assignment' | 'Permission assignment'): AppError =>
  new AppError({ statusCode: 404, code: 'NOT_FOUND', message: `${entity} was not found.` });
const identityConflict = (field?: 'email' | 'username'): AppError => new AppError({
  statusCode: 409,
  code: 'USER_IDENTITY_CONFLICT',
  message: 'An Admin user already uses this email or username.',
  ...(field ? { details: { field } } : {}),
});

export class RbacMutationService {
  public constructor(
    private readonly repository: RbacMutationRepository,
    private readonly audit: RbacSecurityAuditSink,
  ) {}

  public createAdmin(context: RbacMutationContext, input: CreateAdminMutationInput): Promise<RbacMutationResult & { userId: number }> {
    return this.executeAudited(context, { action: 'admin.user.create', targetType: 'User' }, async (transaction) => {
      if (input.roleIds.length === 0) {
        throw new AppError({ statusCode: 409, code: 'ROLE_REQUIRED', message: 'At least one active role is required.' });
      }
      assertUniqueIdentifiers(input.roleIds, 'role');
      const actor = await this.resolveActor(transaction, context.actorUserId);
      requireSystemAdminActor(actor);
      const conflict = await transaction.findUserIdentityConflict(input.email, input.username);
      if (conflict) throw identityConflict(conflict);
      const roles = await transaction.findRoles(input.roleIds);
      this.assertEveryRoleExists(input.roleIds, roles);
      for (const role of roles) assertRoleAssignable(role, actor);
      try {
        const userId = await transaction.createAdminUser({ ...input, createdById: context.actorUserId });
        return { changed: true, userId, targetId: userId, beforeIds: [], afterIds: [...input.roleIds] };
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) throw identityConflict();
        throw error;
      }
    }) as Promise<RbacMutationResult & { userId: number }>;
  }

  public updateAdminProfile(
    context: RbacMutationContext,
    targetUserId: number,
    input: UpdateAdminProfileMutationInput,
  ): Promise<RbacMutationResult> {
    return this.executeAudited(
      context,
      { action: 'admin.user.update', targetType: 'User', targetId: targetUserId },
      async (transaction) => {
        requireSystemAdminActor(await this.resolveActor(transaction, context.actorUserId));
        const target = await transaction.findUserProfile(targetUserId);
        if (!target) throw notFound('User');
        const email = input.email ?? target.email;
        const username = input.username ?? target.username;
        const conflict = await transaction.findUserIdentityConflict(email, username, targetUserId);
        if (conflict) throw identityConflict(conflict);
        const changed = (input.name !== undefined && input.name !== target.name)
          || (input.email !== undefined && input.email !== target.email)
          || (input.username !== undefined && input.username !== target.username);
        if (changed) {
          try {
            await transaction.updateAdminUserProfile(targetUserId, input, context.actorUserId);
          } catch (error) {
            if (isPrismaUniqueConstraintError(error)) throw identityConflict();
            throw error;
          }
        }
        return { changed };
      },
    );
  }

  public activateUser(context: RbacMutationContext, targetUserId: number): Promise<RbacMutationResult> {
    return this.executeAudited(
      context,
      { action: 'admin.user.activate', targetType: 'User', targetId: targetUserId },
      async (transaction) => {
        requireSystemAdminActor(await this.resolveActor(transaction, context.actorUserId));
        const target = await transaction.findUser(targetUserId);
        if (!target) throw notFound('User');
        if (target.status === Status.ACTIVE) return { changed: false };
        await transaction.updateUserStatus(targetUserId, Status.ACTIVE, context.actorUserId);
        return { changed: true };
      },
    );
  }

  public assignRole(context: RbacMutationContext, targetUserId: number, roleId: number): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.role.assign', targetType: 'UserRole', targetId: targetUserId },
      (transaction) => this.assignRoleInTransaction(transaction, context, targetUserId, roleId));
  }

  public removeRole(context: RbacMutationContext, targetUserId: number, roleId: number): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.role.remove', targetType: 'UserRole', targetId: targetUserId },
      async (transaction) => {
        const actor = await this.resolveActor(transaction, context.actorUserId);
        requireSystemAdminActor(actor);
        const target = await transaction.findUser(targetUserId);
        if (!target) throw notFound('User');
        const role = await transaction.findRole(roleId);
        if (!role) throw notFound('Role');
        if (!(await transaction.hasUserRole(targetUserId, roleId))) throw notFound('Role assignment');

        if (isSystemAdminRoleName(role.name)) {
          assertRoleCanBeRemovedFromUser(actor, targetUserId, role);
          if (target.isActiveSystemAdmin) {
            assertSystemAdminInvariant((await transaction.countActiveSystemAdmins()) - 1);
          }
        }

        const changed = await transaction.deleteUserRole(targetUserId, roleId);
        return { changed, beforeIds: [roleId], afterIds: changed ? [] : [roleId] };
      });
  }

  public replaceUserRoles(
    context: RbacMutationContext,
    targetUserId: number,
    proposedRoleIds: readonly number[],
  ): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.roles.replace', targetType: 'UserRole', targetId: targetUserId },
      async (transaction) => {
        assertUniqueIdentifiers(proposedRoleIds, 'role');
        const actor = await this.resolveActor(transaction, context.actorUserId);
        requireSystemAdminActor(actor);
        const target = await transaction.findUser(targetUserId);
        if (!target) throw notFound('User');
        const proposedRoles = await transaction.findRoles(proposedRoleIds);
        this.assertEveryRoleExists(proposedRoleIds, proposedRoles);
        const currentRoleIds = await transaction.listUserRoleIds(targetUserId);
        const currentRoles = await transaction.findRoles(currentRoleIds);
        const systemRole = [...currentRoles, ...proposedRoles].find((role) => isSystemAdminRoleName(role.name));
        for (const role of proposedRoles) assertRoleAssignable(role, actor);

        const keepsSystemRole = proposedRoles.some((role) => isSystemAdminRoleName(role.name));
        if (systemRole) {
          assertProtectedRoleRelationshipActor(systemRole.name, actor);
        }
        if (target.isActiveSystemAdmin && !keepsSystemRole) {
          assertRoleCanBeRemovedFromUser(actor, targetUserId, currentRoles.find((role) => isSystemAdminRoleName(role.name))!);
          assertSystemAdminInvariant((await transaction.countActiveSystemAdmins()) - 1);
        }

        const unchanged = currentRoleIds.length === proposedRoleIds.length
          && currentRoleIds.every((roleId) => proposedRoleIds.includes(roleId));
        if (!unchanged) await transaction.replaceUserRoles(targetUserId, proposedRoleIds);
        return {
          changed: !unchanged,
          beforeIds: currentRoleIds,
          afterIds: [...proposedRoleIds].sort((left, right) => left - right),
        };
      });
  }

  public deactivateUser(context: RbacMutationContext, targetUserId: number): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.user.deactivate', targetType: 'User', targetId: targetUserId },
      async (transaction) => {
        const actor = await this.resolveActor(transaction, context.actorUserId);
        requireSystemAdminActor(actor);
        const target = await transaction.findUser(targetUserId);
        if (!target) throw notFound('User');
        if (target.status === Status.INACTIVE) return { changed: false };

        if (target.isActiveSystemAdmin) {
          assertUserCanBeDeactivated(actor, target);
          assertSystemAdminInvariant((await transaction.countActiveSystemAdmins()) - 1);
        }

        await transaction.updateUserStatus(targetUserId, Status.INACTIVE, context.actorUserId);
        return { changed: true };
      });
  }

  public assignPermission(
    context: RbacMutationContext,
    roleId: number,
    permissionId: number,
  ): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.permission.assign', targetType: 'RolePermission', targetId: roleId },
      async (transaction) => {
        const role = await transaction.findRole(roleId);
        if (!role) throw notFound('Role');
        const permission = await transaction.findPermission(permissionId);
        if (!permission) throw notFound('Permission');
        if (isSystemAdminRoleName(role.name)) {
          assertProtectedRoleRelationshipActor(role.name, await this.resolveActor(transaction, context.actorUserId));
        }
        assertPermissionAssignable(permission);
        if (await transaction.hasRolePermission(roleId, permissionId)) {
          return { changed: false, beforeIds: [permissionId], afterIds: [permissionId] };
        }
        const changed = await transaction.createRolePermission(roleId, permissionId);
        return { changed, beforeIds: [], afterIds: [permissionId] };
      });
  }

  public removePermission(
    context: RbacMutationContext,
    roleId: number,
    permissionId: number,
  ): Promise<RbacMutationResult> {
    return this.executeAudited(context, { action: 'admin.permission.remove', targetType: 'RolePermission', targetId: roleId },
      async (transaction) => {
        const role = await transaction.findRole(roleId);
        if (!role) throw notFound('Role');
        if (!(await transaction.findPermission(permissionId))) throw notFound('Permission');
        if (!(await transaction.hasRolePermission(roleId, permissionId))) throw notFound('Permission assignment');
        if (isSystemAdminRoleName(role.name)) {
          assertProtectedRoleRelationshipActor(role.name, await this.resolveActor(transaction, context.actorUserId));
        }
        const changed = await transaction.deleteRolePermission(roleId, permissionId);
        return { changed, beforeIds: [permissionId], afterIds: changed ? [] : [permissionId] };
      });
  }

  private async assignRoleInTransaction(
    transaction: RbacMutationTransaction,
    context: RbacMutationContext,
    targetUserId: number,
    roleId: number,
  ): Promise<InternalMutationResult> {
    const actor = await this.resolveActor(transaction, context.actorUserId);
    requireSystemAdminActor(actor);
    if (!(await transaction.findUser(targetUserId))) throw notFound('User');
    const role = await transaction.findRole(roleId);
    if (!role) throw notFound('Role');
    assertRoleAssignable(role, actor);
    if (await transaction.hasUserRole(targetUserId, roleId)) {
      return { changed: false, beforeIds: [roleId], afterIds: [roleId] };
    }
    const changed = await transaction.createUserRole(targetUserId, roleId);
    return { changed, beforeIds: [], afterIds: [roleId] };
  }

  private async resolveActor(transaction: RbacMutationTransaction, actorUserId: number): Promise<RbacMutationActor> {
    const actor = await transaction.findUser(actorUserId);
    return { userId: actorUserId, isSystemAdmin: actor?.isActiveSystemAdmin === true };
  }

  private assertEveryRoleExists(requestedIds: readonly number[], roles: readonly RbacRoleState[]): void {
    if (roles.length !== requestedIds.length) throw notFound('Role');
  }

  private async executeAudited(
    context: RbacMutationContext,
    target: AuditTarget,
    operation: (transaction: RbacMutationTransaction) => Promise<InternalMutationResult>,
  ): Promise<RbacMutationResult> {
    try {
      const result = await this.repository.executeSerializable(operation);
      this.recordAudit(
        context,
        { ...target, ...(result.targetId === undefined ? {} : { targetId: result.targetId }) },
        result.changed ? 'changed' : 'no_change',
        result,
      );
      return { changed: result.changed, ...('userId' in result ? { userId: result.userId } : {}) };
    } catch (error) {
      const mappedError = ['admin.user.create', 'admin.user.update'].includes(target.action)
        && isPrismaUniqueConstraintError(error)
        ? identityConflict()
        : error;
      this.recordAudit(
        context,
        target,
        'rejected',
        undefined,
        mappedError instanceof AppError ? mappedError.code : 'INTERNAL_ERROR',
      );
      throw mappedError;
    }
  }

  private recordAudit(
    context: RbacMutationContext,
    target: AuditTarget,
    outcome: RbacSecurityAuditOutcome,
    identifiers?: Pick<InternalMutationResult, 'beforeIds' | 'afterIds'>,
    reasonCode?: string,
  ): void {
    try {
      this.audit.record({
        requestId: context.requestId,
        actorUserId: context.actorUserId,
        ...target,
        ...(identifiers?.beforeIds ? { beforeIds: identifiers.beforeIds } : {}),
        ...(identifiers?.afterIds ? { afterIds: identifiers.afterIds } : {}),
        outcome,
        ...(reasonCode ? { reasonCode } : {}),
      });
    } catch {
      // Operational logging must not turn a committed mutation into an apparent
      // failure that a caller might retry. Production transports must alert on
      // their own delivery failures.
    }
  }
}
