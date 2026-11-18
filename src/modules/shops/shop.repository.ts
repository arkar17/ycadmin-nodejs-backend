import type { MemberRequestStatus, Prisma, Status } from '@prisma/client';
import { getPrismaClient } from '../../database/prisma.js';

const select = {
  id: true, name: true, logo: true, status: true, memberId: true, createdAt: true, updatedAt: true,
  member: { select: { id: true, name: true, code: true, email: true, phone: true } },
  shopLevel: { select: { id: true, name: true, status: true, postLimit: true, price: true, duration: true, planDuration: { select: { id: true, name: true, value: true } } } },
  createdBy: { select: { id: true, name: true } }, updatedBy: { select: { id: true, name: true } },
  _count: { select: { posts: true, shopRatings: true } },
  shopRatings: { select: { rate: true } },
} satisfies Prisma.ShopSelect;

type Base = Prisma.ShopGetPayload<{ select: typeof select }>;
export type ShopUpgradeSummaryRecord = { id: number; status: MemberRequestStatus; postCount: number; createdAt: Date };
export type ShopRecord = Base & { latestUpgradeRequest: ShopUpgradeSummaryRecord | null; latestApprovedUpgradeRequest: ShopUpgradeSummaryRecord | null };
export type ShopPage = { records: ShopRecord[]; total: number };
export type ShopQuery = { name?: string; memberId?: number; memberName?: string; memberCode?: string; shopLevelId?: number; status?: Status; limit: number; offset: number };

export interface ShopRepository { findPage(query: ShopQuery): Promise<ShopPage>; findById(id: number): Promise<ShopRecord | null> }

const whereFor = (query: Omit<ShopQuery, 'limit' | 'offset'>): Prisma.ShopWhereInput => ({
  ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}),
  ...(query.memberId ? { memberId: query.memberId } : {}),
  ...(query.memberName || query.memberCode ? { member: { is: {
    ...(query.memberName ? { name: { contains: query.memberName, mode: 'insensitive' as const } } : {}),
    ...(query.memberCode ? { code: { contains: query.memberCode, mode: 'insensitive' as const } } : {}),
  } } } : {}),
  ...(query.shopLevelId ? { shopLevelId: query.shopLevelId } : {}),
  ...(query.status ? { status: query.status } : {}),
});

const attachRequests = async (records: Base[]): Promise<ShopRecord[]> => {
  const memberIds = records.flatMap((record) => record.memberId === null ? [] : [record.memberId]);
  if (memberIds.length === 0) return records.map((record) => ({ ...record, latestUpgradeRequest: null, latestApprovedUpgradeRequest: null }));
  const requests = await getPrismaClient().shopUpgradeRequest.findMany({
    where: { memberId: { in: memberIds } },
    select: { id: true, memberId: true, status: true, postCount: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const latest = new Map<number, ShopUpgradeSummaryRecord>();
  const approved = new Map<number, ShopUpgradeSummaryRecord>();
  for (const request of requests) {
    if (!latest.has(request.memberId)) latest.set(request.memberId, request);
    if (request.status === 'APPROVED' && !approved.has(request.memberId)) approved.set(request.memberId, request);
  }
  return records.map((record) => ({
    ...record,
    latestUpgradeRequest: record.memberId === null ? null : latest.get(record.memberId) ?? null,
    latestApprovedUpgradeRequest: record.memberId === null ? null : approved.get(record.memberId) ?? null,
  }));
};

export class PrismaShopRepository implements ShopRepository {
  public async findPage(query: ShopQuery): Promise<ShopPage> {
    const prisma = getPrismaClient(); const where = whereFor(query);
    const [records, total] = await prisma.$transaction([
      prisma.shop.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.shop.count({ where }),
    ]);
    return { records: await attachRequests(records), total };
  }
  public async findById(id: number): Promise<ShopRecord | null> {
    const record = await getPrismaClient().shop.findUnique({ where: { id }, select });
    return record ? (await attachRequests([record]))[0]! : null;
  }
}
