import { Status } from '@prisma/client';

import { hasSystemAdminRole } from './admin-access-policy.js';
import type { CurrentAdminRecord, CurrentAdminRepository } from './current-admin.repository.js';
import { AppError } from '../../shared/app-error.js';

export type CurrentAdminIdentity = {
  id: number;
  name: string;
  email: string;
  username: string;
  status: Status;
  roles: { id: number; name: string }[];
  permissions: { id: number; name: string; description: string | null }[];
  isSystemAdmin: boolean;
};

export class CurrentAdminService {
  public constructor(private readonly repository: CurrentAdminRepository) {}

  public async get(id: number): Promise<CurrentAdminIdentity> {
    const user = await this.repository.findById(id);
    if (!user || user.status !== Status.ACTIVE) {
      throw new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' });
    }
    const identity = this.toIdentity(user);
    if (identity.roles.length === 0) {
      throw new AppError({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'Authentication is required.' });
    }
    return identity;
  }

  private readonly toIdentity = (user: CurrentAdminRecord): CurrentAdminIdentity => {
    const roles = user.roles.filter((role) => role.status === Status.ACTIVE);
    const permissions = new Map<number, { id: number; name: string; description: string | null }>();
    for (const role of roles) {
      for (const permission of role.permissions) {
        if (permission.status === Status.ACTIVE) {
          permissions.set(permission.id, {
            id: permission.id,
            name: permission.name,
            description: permission.description,
          });
        }
      }
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      status: user.status,
      roles: roles.map(({ id, name }) => ({ id, name })),
      permissions: [...permissions.values()].sort((left, right) => left.name.localeCompare(right.name)),
      isSystemAdmin: hasSystemAdminRole(roles.map((role) => role.name)),
    };
  };
}
