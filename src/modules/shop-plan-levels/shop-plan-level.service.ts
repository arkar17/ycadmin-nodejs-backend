import { Prisma } from '@prisma/client';

import { AppError } from '../../shared/app-error.js';
import type { ShopPlanLevelRecord, ShopPlanLevelRepository } from './shop-plan-level.repository.js';
import type { ShopPlanLevelCreateInput, ShopPlanLevelListQuery, ShopPlanLevelUpdateInput } from './shop-plan-level.schema.js';

export type ShopPlanLevelItem = {
  id: number;
  name: string;
  price: number;
  duration: number;
  postLimit: number;
  status: string;
  planDuration: { id: number; name: string; value: number } | null;
  createdAt: string;
};

export class ShopPlanLevelService {
  public constructor(private readonly repository: ShopPlanLevelRepository) {}

  public async list(query: ShopPlanLevelListQuery): Promise<{ data: ShopPlanLevelItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toItem), total: page.total };
  }

  public async detail(id: number): Promise<ShopPlanLevelItem> {
    const record = await this.repository.findById(id);
    if (!record) throw this.notFound();
    return this.toItem(record);
  }

  public async create(input: ShopPlanLevelCreateInput, actorId: number): Promise<ShopPlanLevelItem> {
    const duration = await this.repository.durationById(input.durationId);
    if (!duration) throw this.invalidDuration();
    if (await this.repository.findByName(input.name)) throw this.nameConflict();
    try {
      return this.toItem(await this.repository.create({ ...input, duration: duration.value, actorId }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw this.nameConflict();
      throw error;
    }
  }

  public async update(id: number, input: ShopPlanLevelUpdateInput, actorId: number): Promise<ShopPlanLevelItem> {
    const existing = await this.repository.findById(id);
    if (!existing) throw this.notFound();
    if (input.name !== undefined && input.name !== existing.name) {
      const sameName = await this.repository.findByName(input.name);
      if (sameName && sameName.id !== id) throw this.nameConflict();
    }
    const duration = input.durationId === undefined ? undefined : await this.repository.durationById(input.durationId);
    if (input.durationId !== undefined && !duration) throw this.invalidDuration();
    try {
      return this.toItem(await this.repository.update(id, { ...input, ...(duration ? { duration: duration.value } : {}), actorId }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw this.nameConflict();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw this.notFound();
      throw error;
    }
  }

  public async remove(id: number): Promise<void> {
    if (!(await this.repository.findById(id))) throw this.notFound();
    await this.assertUnreferenced(id);
    try {
      await this.repository.delete(id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw this.inUse(await this.repository.references(id));
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw this.notFound();
      throw error;
    }
  }

  private async assertUnreferenced(id: number): Promise<void> {
    const references = await this.repository.references(id);
    if (Object.values(references).some((count) => count > 0)) throw this.inUse(references);
  }

  private notFound(): AppError {
    return new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Shop plan level was not found.' });
  }

  private invalidDuration(): AppError {
    return new AppError({ statusCode: 422, code: 'INVALID_REFERENCE', message: 'Referenced durationId does not exist.', details: { field: 'durationId' } });
  }

  private nameConflict(): AppError {
    return new AppError({ statusCode: 409, code: 'SHOP_LEVEL_NAME_CONFLICT', message: 'A shop plan level with this name already exists.' });
  }

  private inUse(details: { shops: number; shopUpgradeRequests: number; payments: number }): AppError {
    return new AppError({ statusCode: 409, code: 'SHOP_LEVEL_IN_USE', message: 'Shop plan level is referenced by existing records and cannot be deleted.', details });
  }

  private readonly toItem = (record: ShopPlanLevelRecord): ShopPlanLevelItem => ({
    id: record.id,
    name: record.name,
    price: record.price,
    duration: record.duration,
    postLimit: record.postLimit,
    status: record.status,
    planDuration: record.planDuration,
    createdAt: record.createdAt.toISOString(),
  });
}
