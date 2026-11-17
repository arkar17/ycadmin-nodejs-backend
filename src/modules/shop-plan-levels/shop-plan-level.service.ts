import { AppError } from '../../shared/app-error.js';
import type { ShopPlanLevelRecord, ShopPlanLevelRepository } from './shop-plan-level.repository.js';
import type { ShopPlanLevelListQuery } from './shop-plan-level.schema.js';

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
    if (!record) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Shop plan level was not found.' });
    return this.toItem(record);
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
