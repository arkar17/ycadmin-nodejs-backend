import type { ClientType, Gender, Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { PrismaMemberManagementRepository } from './member-management.repository.js';

export type MemberDirectoryQuery = {
  name?: string;
  contact?: string;
  limit: number;
  offset: number;
};

export type MemberDirectoryRecord = {
  id: number;
  code: string;
  name: string;
  clientType: ClientType;
  phone: string | null;
  email: string | null;
  profile: {
    gender: Gender | null;
    address: string | null;
  } | null;
};

export type MemberDirectoryPage = {
  records: MemberDirectoryRecord[];
  total: number;
};

export interface MemberDirectoryRepository {
  findPage(query: MemberDirectoryQuery): Promise<MemberDirectoryPage>;
}

const createWhere = ({ name, contact }: MemberDirectoryQuery): Prisma.MemberWhereInput => ({
  ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
  ...(contact
    ? {
        OR: [
          { phone: { contains: contact, mode: 'insensitive' } },
          { email: { contains: contact, mode: 'insensitive' } },
        ],
      }
    : {}),
});

/** Schema-backed repository; use only after isolated database integration is approved. */
export class PrismaMemberDirectoryRepository extends PrismaMemberManagementRepository implements MemberDirectoryRepository {
  public async findPage(query: MemberDirectoryQuery): Promise<MemberDirectoryPage> {
    const prisma = getPrismaClient();
    const where = createWhere(query);
    const select = {
      id: true,
      code: true,
      name: true,
      clientType: true,
      phone: true,
      email: true,
      profile: { select: { gender: true, address: true } },
    };

    const [records, total] = await prisma.$transaction([
      prisma.member.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.member.count({ where }),
    ]);

    return { records, total };
  }
}
