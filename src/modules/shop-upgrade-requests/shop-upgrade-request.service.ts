import { AppError } from '../../shared/app-error.js';
import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { ShopUpgradePaymentProofService } from './shop-upgrade-payment-proof.service.js';
import type { ShopUpgradeRequestRecord, ShopUpgradeRequestRepository } from './shop-upgrade-request.repository.js';
import type { ShopUpgradeRequestListQuery } from './shop-upgrade-request.schema.js';

export class ShopUpgradeRequestService {
  public constructor(private readonly repository: ShopUpgradeRequestRepository, private readonly proofService: ShopUpgradePaymentProofService) {}
  public async list(query: ShopUpgradeRequestListQuery) { const page = await this.repository.findPage({ ...query, ...(query.date ? { createdAt: yangonDateToUtcRange(query.date) } : {}) }); return { data: page.records.map(this.item), total: page.total }; }
  public async detail(id: number) { const record = await this.repository.findById(id); if (!record) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Shop upgrade request was not found.' }); return this.detailItem(record); }
  public async approve(id: number, paymentId: number, actorUserId: number) { const result = await this.repository.approve({ requestId: id, paymentId, actorUserId }); return { changed: result.changed, shopUpgradeRequest: this.detailItem(result.request) }; }
  public async reject(id: number, paymentId: number, reason: string, actorUserId: number) { const result = await this.repository.reject({ requestId: id, paymentId, reason, actorUserId }); return { changed: result.changed, shopUpgradeRequest: this.detailItem(result.request) }; }
  public proof(requestId: number, paymentId: number): Promise<Buffer> { return this.proofService.get(requestId, paymentId); }
  private readonly level = (level: ShopUpgradeRequestRecord['shopLevel']) => ({ id: level.id, name: level.name, status: level.status, currentCatalogPrice: level.price, currentCatalogDuration: level.duration, currentCatalogPostLimit: level.postLimit, planDuration: level.planDuration });
  private readonly payment = (record: ShopUpgradeRequestRecord, payment: ShopUpgradeRequestRecord['payments'][number]) => {
    const proof = this.proofService.describe(record.id, payment);
    if (!payment.structurallyMatches || !record.member.shop) delete proof.paymentProofPath;
    return { id: payment.id, status: payment.status, amount: payment.amount, requestedAt: payment.requestDate?.toISOString() ?? null, paymentDestination: { id: payment.bankInformation.id, name: payment.bankInformation.name, paymentType: payment.bankInformation.paymentTypes }, structurallyMatches: payment.structurallyMatches, ...proof };
  };
  private readonly item = (record: ShopUpgradeRequestRecord) => ({ id: record.id, status: record.status, member: { id: record.member.id, name: record.member.name, clientCode: record.member.code }, requestedLevel: this.level(record.shopLevel), postCount: record.postCount, payments: record.payments.map((payment) => this.payment(record, payment)), requestedAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() });
  private readonly detailItem = (record: ShopUpgradeRequestRecord) => ({
    ...this.item(record), rejectedReason: record.rejectedReason, approvedAt: record.approvedAt?.toISOString() ?? null, rejectedAt: record.rejectedAt?.toISOString() ?? null, approvedBy: record.approvedBy, rejectedBy: record.rejectedBy,
    member: { id: record.member.id, name: record.member.name, clientCode: record.member.code, email: record.member.email },
    shop: record.member.shop ? { id: record.member.shop.id, name: record.member.shop.name, status: record.member.shop.status } : null,
    currentLevel: record.member.shop?.shopLevel ? this.level(record.member.shop.shopLevel) : null,
  });
}
