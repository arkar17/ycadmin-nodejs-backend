import type { RbacMutationContext, RbacMutationService } from '../admin-rbac/rbac-mutation.service.js';
import type { AdminRoleCreateInput, AdminRoleUpdateInput } from './admin-role.schema.js';
import type { AdminRoleService } from './admin-role.service.js';

export class AdminRoleManagementService {
  public constructor(
    private readonly roles: AdminRoleService,
    private readonly mutations: RbacMutationService,
  ) {}

  public async create(context: RbacMutationContext, input: AdminRoleCreateInput) {
    const result = await this.mutations.createRole(context, input);
    return { changed: result.changed, role: await this.roles.detail(result.roleId) };
  }

  public async update(context: RbacMutationContext, roleId: number, input: AdminRoleUpdateInput) {
    const result = await this.mutations.updateRole(context, roleId, input);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }

  public async activate(context: RbacMutationContext, roleId: number) {
    const result = await this.mutations.activateRole(context, roleId);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }

  public async deactivate(context: RbacMutationContext, roleId: number) {
    const result = await this.mutations.deactivateRole(context, roleId);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }

  public async assignPermission(context: RbacMutationContext, roleId: number, permissionId: number) {
    const result = await this.mutations.assignPermission(context, roleId, permissionId);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }

  public async removePermission(context: RbacMutationContext, roleId: number, permissionId: number) {
    const result = await this.mutations.removePermission(context, roleId, permissionId);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }

  public async replacePermissions(context: RbacMutationContext, roleId: number, permissionIds: readonly number[]) {
    const result = await this.mutations.replaceRolePermissions(context, roleId, permissionIds);
    return { changed: result.changed, role: await this.roles.detail(roleId) };
  }
}
