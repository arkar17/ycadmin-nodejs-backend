import { Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type AdminIdentity = {
  id: number;
  displayName: string;
  roleNames: string[];
  permissionNames: string[];
};

export interface AdminIdentityRepository {
  findActiveAdminById(id: number): Promise<AdminIdentity | null>;
}

/**
 * Resolves the current User-side RBAC state for every authenticated request.
 * Member identities are intentionally not queried here.
 */
export class PrismaAdminIdentityRepository implements AdminIdentityRepository {
  public async findActiveAdminById(id: number): Promise<AdminIdentity | null> {
    const user = await getPrismaClient().user.findFirst({
      where: { id, status: Status.ACTIVE },
      select: {
        id: true,
        name: true,
        roles: {
          where: { role: { status: Status.ACTIVE } },
          select: {
            role: {
              select: {
                name: true,
                permissions: {
                  where: { permission: { status: Status.ACTIVE } },
                  select: { permission: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return null;

    const roleNames = user.roles.map(({ role }) => role.name);
    const permissionNames = [
      ...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.name))),
    ];

    return { id: user.id, displayName: user.name, roleNames, permissionNames };
  }
}
