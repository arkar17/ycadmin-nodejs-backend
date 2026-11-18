import { AppError } from '../../shared/app-error.js';
import type { ShopListQuery } from './shop.schema.js';
import type { ShopRecord, ShopRepository } from './shop.repository.js';

const summaries = (record: ShopRecord) => {
  const ratingTotal = record.shopRatings.reduce((sum, rating) => sum + rating.rate, 0);
  return {
    // Shared Mobile semantics treat the latest approved request's postCount as
    // remaining quota. A legacy Mobile delete of an older post can therefore
    // restore quota to this latest entitlement; this task intentionally does
    // not redesign that accounting contract.
    posts: { total: record._count.posts, remaining: record.latestApprovedUpgradeRequest?.postCount ?? 0, quotaRequestId: record.latestApprovedUpgradeRequest?.id ?? null },
    ratings: { count: record._count.shopRatings, average: record._count.shopRatings === 0 ? null : ratingTotal / record._count.shopRatings },
    latestUpgradeRequest: record.latestUpgradeRequest ? { id: record.latestUpgradeRequest.id, status: record.latestUpgradeRequest.status, requestedAt: record.latestUpgradeRequest.createdAt.toISOString() } : null,
  };
};

const item = (record: ShopRecord) => ({
  id: record.id, name: record.name, status: record.status, hasLogo: Boolean(record.logo?.trim()),
  owner: record.member ? { id: record.member.id, name: record.member.name, clientCode: record.member.code } : null,
  currentLevel: record.shopLevel ? { id: record.shopLevel.id, name: record.shopLevel.name, status: record.shopLevel.status, postLimit: record.shopLevel.postLimit } : null,
  ...summaries(record), createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
});

export class ShopService {
  public constructor(private readonly repository: ShopRepository) {}
  public async list(query: ShopListQuery) { const page = await this.repository.findPage(query); return { data: page.records.map(item), total: page.total }; }
  public async detail(id: number) {
    const record = await this.repository.findById(id);
    if (!record) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Shop was not found.' });
    return {
      ...item(record),
      owner: record.member ? { id: record.member.id, name: record.member.name, clientCode: record.member.code, email: record.member.email, phone: record.member.phone } : null,
      currentLevel: record.shopLevel ? { id: record.shopLevel.id, name: record.shopLevel.name, status: record.shopLevel.status, postLimit: record.shopLevel.postLimit, currentPrice: record.shopLevel.price, duration: record.shopLevel.duration, planDuration: record.shopLevel.planDuration } : null,
      createdBy: record.createdBy, updatedBy: record.updatedBy,
    };
  }
}
