import type { Prisma, Status } from '@prisma/client';
import { Status as StatusValue } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type AdminUserListRepositoryQuery = {
  search?: string;
  status?: Status;
  role?: string;
  limit: number;
  offset: number;
};

export type AdminUserListRecord = {
  id: number;
  name: string;
  email: string;
  username: string;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  roles: { id: number; name: string }[];
};

export type AdminUserDetailRecord = Omit<AdminUserListRecord, 'roles'> & {
  roles: {
    id: number;
    name: string;
    status: Status;
    permissions: { id: number; name: string; description: string | null; status: Status }[];
  }[];
};

export interface AdminUserRepository {
  findPage(query: AdminUserListRepositoryQuery): Promise<{ records: AdminUserListRecord[]; total: number }>;
  findById(id: number): Promise<AdminUserDetailRecord | null>;
}

const whereFor = (query: AdminUserListRepositoryQuery): Prisma.UserWhereInput => ({
  ...(query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { username: { contains: query.search, mode: 'insensitive' } },
        ],
      }
    : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.role
    ? { roles: { some: { role: { status: StatusValue.ACTIVE, name: query.role } } } }
    : {}),
});

export class PrismaAdminUserRepository implements AdminUserRepository {
  public async findPage(query: AdminUserListRepositoryQuery) {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          roles: {
            where: { role: { status: StatusValue.ACTIVE } },
            select: { role: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      records: users.map((user) => ({ ...user, roles: user.roles.map(({ role }) => role) })),
      total,
    };
  }

  public async findById(id: number): Promise<AdminUserDetailRecord | null> {
    const user = await getPrismaClient().user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                status: true,
                permissions: {
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
