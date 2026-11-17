import { Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type CurrentAdminRecord = {
  id: number;
  name: string;
  email: string;
  username: string;
  status: Status;
  roles: {
    id: number;
    name: string;
    status: Status;
    permissions: { id: number; name: string; description: string | null; status: Status }[];
  }[];
};

export interface CurrentAdminRepository {
  findById(id: number): Promise<CurrentAdminRecord | null>;
}

export class PrismaCurrentAdminRepository implements CurrentAdminRepository {
  public async findById(id: number): Promise<CurrentAdminRecord | null> {
    const user = await getPrismaClient().user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        roles: {
          where: { role: { status: Status.ACTIVE } },
          select: {
            role: {
              select: {
                id: true,
                name: true,
                status: true,
                permissions: {
                  where: { permission: { status: Status.ACTIVE } },
                  select: { permission: { select: { id: true, name: true, description: true, status: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return null;
    return {
      ...user,
      roles: user.roles.map(({ role }) => ({
        ...role,
        permissions: role.permissions.map(({ permission }) => permission),
      })),
    };
  }
}
