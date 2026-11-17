import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type PlanDurationRecord = { id: number; name: string; value: number; createdAt: Date; updatedAt: Date };
export type PlanDurationPage = { records: PlanDurationRecord[]; total: number };
export type PlanDurationReferenceCount = { memberPlans: number; shopLevels: number };

export interface PlanDurationRepository {
  findPage(query: { name?: string; limit: number; offset: number }): Promise<PlanDurationPage>;
  findById(id: number): Promise<PlanDurationRecord | null>;
  findByValue(value: number): Promise<PlanDurationRecord | null>;
  create(input: { name: string; value: number }): Promise<PlanDurationRecord>;
  update(id: number, input: { name?: string; value?: number }): Promise<PlanDurationRecord>;
  referenceCount(id: number): Promise<PlanDurationReferenceCount>;
  delete(id: number): Promise<void>;
}

const select = { id: true, name: true, value: true, createdAt: true, updatedAt: true };

export class PrismaPlanDurationRepository implements PlanDurationRepository {
  public async findPage(query: { name?: string; limit: number; offset: number }): Promise<PlanDurationPage> {
    const prisma = getPrismaClient();
    const where: Prisma.PlanDurationWhereInput = query.name
      ? { name: { contains: query.name, mode: 'insensitive' } }
      : {};
    const [records, total] = await prisma.$transaction([
      prisma.planDuration.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.planDuration.count({ where }),
    ]);
    return { records, total };
  }

  public async findById(id: number): Promise<PlanDurationRecord | null> {
    return getPrismaClient().planDuration.findUnique({ where: { id }, select });
  }

  public async findByValue(value: number): Promise<PlanDurationRecord | null> {
    return getPrismaClient().planDuration.findUnique({ where: { value }, select });
  }

  public async create(input: { name: string; value: number }): Promise<PlanDurationRecord> {
    return getPrismaClient().planDuration.create({ data: input, select });
  }

  public async update(id: number, input: { name?: string; value?: number }): Promise<PlanDurationRecord> {
    return getPrismaClient().planDuration.update({ where: { id }, data: input, select });
  }

  public async referenceCount(id: number): Promise<PlanDurationReferenceCount> {
    const prisma = getPrismaClient();
    const [memberPlans, shopLevels] = await Promise.all([
      prisma.memberPlan.count({ where: { durationId: id } }),
      prisma.shopLevel.count({ where: { durationId: id } }),
    ]);
    return { memberPlans, shopLevels };
  }

  public async delete(id: number): Promise<void> {
    await getPrismaClient().planDuration.delete({ where: { id } });
  }
}
