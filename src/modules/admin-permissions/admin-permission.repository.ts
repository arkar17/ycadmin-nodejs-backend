import type { Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type AdminPermissionListRepositoryQuery = {
  search?: string;
  status?: Status;
  resourcePrefix?: string;
  limit: number;
  offset: number;
};

export type AdminPermissionRecord = {
  id: number;
  name: string;
  description: string | null;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminPermissionDetailRecord = AdminPermissionRecord & {
  roles: { id: number; name: string; status: Status }[];
};

export interface AdminPermissionRepository {
  findPage(query: AdminPermissionListRepositoryQuery): Promise<{ records: AdminPermissionRecord[]; total: number }>;
  findById(id: number): Promise<AdminPermissionDetailRecord | null>;
}

const whereFor = (query: AdminPermissionListRepositoryQuery): Prisma.PermissionWhereInput => {
  const prefix = query.resourcePrefix
    ? query.resourcePrefix.endsWith(':') ? query.resourcePrefix : `${query.resourcePrefix}:`
    : undefined;
  return {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(prefix ? { name: { startsWith: prefix } } : {}),
  };
};

export class PrismaAdminPermissionRepository implements AdminPermissionRepository {
  public async findPage(query: AdminPermissionListRepositoryQuery) {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [permissions, total] = await prisma.$transaction([
      prisma.permission.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.permission.count({ where }),
    ]);
    return { records: permissions, total };
  }

  public async findById(id: number): Promise<AdminPermissionDetailRecord | null> {
    const permission = await getPrismaClient().permission.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        RolePermission: {
          select: { role: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!permission) return null;
    const { RolePermission, ...fields } = permission;
    return { ...fields, roles: RolePermission.map(({ role }) => role) };
  }
}
