import type { Prisma, Status } from '@prisma/client';
import { Status as StatusValue } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type AdminRoleListRepositoryQuery = {
  search?: string;
  status?: Status;
  limit: number;
  offset: number;
};

export type AdminRoleListRecord = {
  id: number;
  name: string;
  description: string | null;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  permissionsCount: number;
  assignedUsersCount: number;
};

export type AdminRoleDetailRecord = Omit<AdminRoleListRecord, 'permissionsCount'> & {
  permissions: { id: number; name: string; description: string | null; status: Status }[];
};

export interface AdminRoleRepository {
  findPage(query: AdminRoleListRepositoryQuery): Promise<{ records: AdminRoleListRecord[]; total: number }>;
  findById(id: number): Promise<AdminRoleDetailRecord | null>;
}

const whereFor = (query: AdminRoleListRepositoryQuery): Prisma.RoleWhereInput => ({
  ...(query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      }
    : {}),
  ...(query.status ? { status: query.status } : {}),
});

export class PrismaAdminRoleRepository implements AdminRoleRepository {
  public async findPage(query: AdminRoleListRepositoryQuery) {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [roles, total] = await prisma.$transaction([
      prisma.role.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              permissions: { where: { permission: { status: StatusValue.ACTIVE } } },
              users: { where: { user: { status: StatusValue.ACTIVE } } },
            },
          },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.role.count({ where }),
    ]);

    return {
      records: roles.map(({ _count, ...role }) => ({
        ...role,
        permissionsCount: _count.permissions,
        assignedUsersCount: _count.users,
      })),
      total,
    };
  }

  public async findById(id: number): Promise<AdminRoleDetailRecord | null> {
    const role = await getPrismaClient().role.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        permissions: {
          where: { permission: { status: StatusValue.ACTIVE } },
          select: { permission: { select: { id: true, name: true, description: true, status: true } } },
        },
        _count: { select: { users: { where: { user: { status: StatusValue.ACTIVE } } } } },
      },
    });
    if (!role) return null;
    const { _count, ...fields } = role;
    return {
      ...fields,
      permissions: role.permissions.map(({ permission }) => permission),
      assignedUsersCount: _count.users,
    };
  }
}
