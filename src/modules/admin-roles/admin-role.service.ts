import { Status } from '@prisma/client';

import { isSystemAdminRoleName } from '../auth/admin-access-policy.js';
import { AppError } from '../../shared/app-error.js';
import type { AdminRoleDetailRecord, AdminRoleListRecord, AdminRoleRepository } from './admin-role.repository.js';
import type { AdminRoleListQuery } from './admin-role.schema.js';

export class AdminRoleService {
  public constructor(private readonly repository: AdminRoleRepository) {}

  public async list(query: AdminRoleListQuery) {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toListItem), total: page.total };
  }

  public async detail(id: number) {
    const role = await this.repository.findById(id);
    if (!role) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Role was not found.' });
    return this.toDetail(role);
  }

  private readonly toListItem = (role: AdminRoleListRecord) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    status: role.status,
    permissionsCount: role.permissionsCount,
    assignedUsersCount: role.assignedUsersCount,
    isSystemRole: isSystemAdminRoleName(role.name),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  });

  private readonly toDetail = (role: AdminRoleDetailRecord) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    status: role.status,
    permissions: role.permissions
      .filter((permission) => permission.status === Status.ACTIVE)
      .map(({ id, name, description, status }) => ({ id, name, description, status }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    assignedUsersCount: role.assignedUsersCount,
    isSystemRole: isSystemAdminRoleName(role.name),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  });
}
