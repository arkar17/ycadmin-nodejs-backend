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
export type ShopPlanLevelReferences = { shops: number; shopUpgradeRequests: number; payments: number };
export type ShopPlanLevelCreateData = {
  name: string;
  price: number;
  durationId: number;
  duration: number;
  description?: string | null;
  postLimit: number;
  status: Status;
  actorId: number;
};
export type ShopPlanLevelUpdateData = Partial<Omit<ShopPlanLevelCreateData, 'actorId' | 'duration'>> & { duration?: number; actorId: number };

export interface ShopPlanLevelRepository {
  findPage(query: { name?: string; status?: Status; durationId?: number; postLimit?: number; limit: number; offset: number }): Promise<ShopPlanLevelPage>;
  findById(id: number): Promise<ShopPlanLevelRecord | null>;
  findByName(name: string): Promise<{ id: number } | null>;
  durationById(id: number): Promise<{ id: number; value: number } | null>;
  references(id: number): Promise<ShopPlanLevelReferences>;
  create(input: ShopPlanLevelCreateData): Promise<ShopPlanLevelRecord>;
  update(id: number, input: ShopPlanLevelUpdateData): Promise<ShopPlanLevelRecord>;
  delete(id: number): Promise<void>;
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

  public async findByName(name: string): Promise<{ id: number } | null> {
    return getPrismaClient().shopLevel.findUnique({ where: { name }, select: { id: true } });
  }

  public async durationById(id: number): Promise<{ id: number; value: number } | null> {
    return getPrismaClient().planDuration.findUnique({ where: { id }, select: { id: true, value: true } });
  }

  public async references(id: number): Promise<ShopPlanLevelReferences> {
    const prisma = getPrismaClient();
    const [shops, shopUpgradeRequests, payments] = await Promise.all([
      prisma.shop.count({ where: { shopLevelId: id } }),
      prisma.shopUpgradeRequest.count({ where: { shopLevelId: id } }),
      prisma.payment.count({ where: { shopLevelId: id } }),
    ]);
    return { shops, shopUpgradeRequests, payments };
  }

  public async create(input: ShopPlanLevelCreateData): Promise<ShopPlanLevelRecord> {
    return getPrismaClient().shopLevel.create({
      data: {
        name: input.name,
        price: input.price,
        durationId: input.durationId,
        duration: input.duration,
        ...(input.description !== undefined ? { description: input.description } : {}),
        postLimit: input.postLimit,
        status: input.status,
        createdById: input.actorId,
      },
      select,
    });
  }

  public async update(id: number, input: ShopPlanLevelUpdateData): Promise<ShopPlanLevelRecord> {
    return getPrismaClient().shopLevel.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.durationId !== undefined ? { durationId: input.durationId, duration: input.duration } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.postLimit !== undefined ? { postLimit: input.postLimit } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedById: input.actorId,
      },
      select,
    });
  }

  public async delete(id: number): Promise<void> {
    await getPrismaClient().shopLevel.delete({ where: { id } });
  }
}
