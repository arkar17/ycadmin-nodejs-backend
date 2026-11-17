import { Status } from '@prisma/client';

import { hasSystemAdminRole } from '../auth/admin-access-policy.js';
import { AppError } from '../../shared/app-error.js';
import type { AdminUserDetailRecord, AdminUserListRecord, AdminUserRepository } from './admin-user.repository.js';
import type { AdminUserListQuery } from './admin-user.schema.js';

export type AdminUserListItem = {
  id: number;
  name: string;
  email: string;
  username: string;
  status: Status;
  roles: { id: number; name: string }[];
  isSystemAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserDetail = Omit<AdminUserListItem, 'roles'> & {
  roles: { id: number; name: string; status: Status }[];
  permissions: { id: number; name: string; description: string | null }[];
};

export class AdminUserService {
  public constructor(private readonly repository: AdminUserRepository) {}

  public async list(query: AdminUserListQuery): Promise<{ data: AdminUserListItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toListItem), total: page.total };
  }

  public async detail(id: number): Promise<AdminUserDetail> {
    const user = await this.repository.findById(id);
    if (!user) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Admin user was not found.' });
    return this.toDetail(user);
  }

  private readonly toListItem = (user: AdminUserListRecord): AdminUserListItem => ({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    status: user.status,
    roles: user.roles,
    isSystemAdmin: hasSystemAdminRole(user.roles.map((role) => role.name)),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });

  private readonly toDetail = (user: AdminUserDetailRecord): AdminUserDetail => {
    const activeRoles = user.roles.filter((role) => role.status === Status.ACTIVE);
    const permissions = new Map<number, { id: number; name: string; description: string | null }>();
    for (const role of activeRoles) {
      for (const permission of role.permissions) {
        if (permission.status === Status.ACTIVE) {
          permissions.set(permission.id, { id: permission.id, name: permission.name, description: permission.description });
        }
      }
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      status: user.status,
      roles: user.roles.map(({ id, name, status }) => ({ id, name, status })),
      permissions: [...permissions.values()].sort((left, right) => left.name.localeCompare(right.name)),
      isSystemAdmin: hasSystemAdminRole(activeRoles.map((role) => role.name)),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  };
}
