import { isSystemAdminRoleName } from '../auth/admin-access-policy.js';
import { AppError } from '../../shared/app-error.js';
import type { AdminPermissionRecord, AdminPermissionRepository } from './admin-permission.repository.js';
import type { AdminPermissionListQuery } from './admin-permission.schema.js';

export class AdminPermissionService {
  public constructor(private readonly repository: AdminPermissionRepository) {}

  public async list(query: AdminPermissionListQuery) {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toListItem), total: page.total };
  }

  public async detail(id: number) {
    const permission = await this.repository.findById(id);
    if (!permission) {
      throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Permission was not found.' });
    }
    return {
      ...this.toListItem(permission),
      roles: permission.roles
        .map(({ id: roleId, name, status }) => ({
          id: roleId,
          name,
          status,
          isSystemRole: isSystemAdminRoleName(name),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  private readonly toListItem = (permission: AdminPermissionRecord) => ({
    id: permission.id,
    name: permission.name,
    description: permission.description,
    status: permission.status,
    createdAt: permission.createdAt.toISOString(),
    updatedAt: permission.updatedAt.toISOString(),
  });
}
