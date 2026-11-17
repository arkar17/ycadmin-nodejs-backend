import type { Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type ShopPlanLevelRecord = {
  id: number;
  name: string;
  price: number;
  duration: number;
  postLimit: number;
  status: Status;
  createdAt: Date;
  planDuration: { id: number; name: string; value: number } | null;
};

export type ShopPlanLevelPage = { records: ShopPlanLevelRecord[]; total: number };

export interface ShopPlanLevelRepository {
  findPage(query: { name?: string; status?: Status; durationId?: number; postLimit?: number; limit: number; offset: number }): Promise<ShopPlanLevelPage>;
  findById(id: number): Promise<ShopPlanLevelRecord | null>;
}

const select = {
  id: true,
  name: true,
  price: true,
  duration: true,
  postLimit: true,
  status: true,
  createdAt: true,
  planDuration: { select: { id: true, name: true, value: true } },
} satisfies Prisma.ShopLevelSelect;

const whereFor = (query: { name?: string; status?: Status; durationId?: number; postLimit?: number }): Prisma.ShopLevelWhereInput => ({
  ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.durationId ? { durationId: query.durationId } : {}),
  ...(query.postLimit !== undefined ? { postLimit: query.postLimit } : {}),
});

export class PrismaShopPlanLevelRepository implements ShopPlanLevelRepository {
  public async findPage(query: { name?: string; status?: Status; durationId?: number; postLimit?: number; limit: number; offset: number }): Promise<ShopPlanLevelPage> {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [records, total] = await prisma.$transaction([
      prisma.shopLevel.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.shopLevel.count({ where }),
    ]);
    return { records, total };
  }

  public async findById(id: number): Promise<ShopPlanLevelRecord | null> {
    return getPrismaClient().shopLevel.findUnique({ where: { id }, select });
  }
}
