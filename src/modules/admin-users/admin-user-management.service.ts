import bcrypt from 'bcrypt';

import type { RbacMutationContext, RbacMutationService } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminUserCreateInput, AdminUserUpdateInput } from './admin-user.schema.js';
import type { AdminUserDetail, AdminUserService } from './admin-user.service.js';

export type AdminUserMutationResponse = { changed: boolean; user: AdminUserDetail };

export class AdminUserManagementService {
  public constructor(
    private readonly users: AdminUserService,
    private readonly mutations: RbacMutationService,
  ) {}

  public async create(context: RbacMutationContext, input: AdminUserCreateInput): Promise<AdminUserMutationResponse> {
    const passwordHash = await bcrypt.hash(input.password, 10);
    const result = await this.mutations.createAdmin(context, {
      name: input.name,
      email: input.email,
      username: input.username,
      passwordHash,
      status: input.status,
      roleIds: input.roleIds,
    });
    return { changed: result.changed, user: await this.users.detail(result.userId) };
  }

  public async update(
    context: RbacMutationContext,
    targetUserId: number,
    input: AdminUserUpdateInput,
  ): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.updateAdminProfile(context, targetUserId, input);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }

  public async activate(context: RbacMutationContext, targetUserId: number): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.activateUser(context, targetUserId);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }

  public async deactivate(context: RbacMutationContext, targetUserId: number): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.deactivateUser(context, targetUserId);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }

  public async assignRole(
    context: RbacMutationContext,
    targetUserId: number,
    roleId: number,
  ): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.assignRole(context, targetUserId, roleId);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }

  public async removeRole(
    context: RbacMutationContext,
    targetUserId: number,
    roleId: number,
  ): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.removeRole(context, targetUserId, roleId);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }

  public async replaceRoles(
    context: RbacMutationContext,
    targetUserId: number,
    roleIds: readonly number[],
  ): Promise<AdminUserMutationResponse> {
    const result = await this.mutations.replaceUserRoles(context, targetUserId, roleIds);
    return { changed: result.changed, user: await this.users.detail(targetUserId) };
  }
}
