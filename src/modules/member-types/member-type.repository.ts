import type { Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type MemberTypeRecord = { id: number; name: string; status: Status; createdAt: Date };
export type MemberTypePage = { records: MemberTypeRecord[]; total: number };

export interface MemberTypeRepository {
  findPage(query: { name?: string; status?: Status; limit: number; offset: number }): Promise<MemberTypePage>;
}

export class PrismaMemberTypeRepository implements MemberTypeRepository {
  public async findPage(query: { name?: string; status?: Status; limit: number; offset: number }): Promise<MemberTypePage> {
    const prisma = getPrismaClient();
    const where: Prisma.MemberTypeWhereInput = {
      ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [records, total] = await prisma.$transaction([
      prisma.memberType.findMany({ where, select: { id: true, name: true, status: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.memberType.count({ where }),
    ]);
    return { records, total };
  }
}
