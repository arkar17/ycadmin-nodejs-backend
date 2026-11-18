import { MemberRequestStatus, NotificationType, PaymentRequestType, PaymentStatus, Prisma, Status } from '@prisma/client';
import { getPrismaClient } from '../../database/prisma.js';
import { AppError } from '../../shared/app-error.js';
import { runWithSerializableRetry } from '../admin-rbac/serializable-transaction.js';

const levelSelect = { id: true, name: true, price: true, duration: true, postLimit: true, status: true, planDuration: { select: { id: true, name: true, value: true } } } satisfies Prisma.ShopLevelSelect;
const paymentSelect = {
  id: true, memberId: true, requestType: true, memberPlanId: true, memberTypeId: true, memberRequestId: true, shopLevelId: true, shopUpgradeRequestId: true,
  status: true, amount: true, requestDate: true, attachment: true, approvedById: true, approvedAt: true, cancelledById: true, cancelledAt: true, cancelledReason: true,
  bankInformation: { select: { id: true, name: true, paymentTypes: true } },
} satisfies Prisma.PaymentSelect;
const select = {
  id: true, memberId: true, shopLevelId: true, postCount: true, status: true, rejectedReason: true, approvedAt: true, rejectedAt: true, createdAt: true, updatedAt: true,
  approvedBy: { select: { id: true, name: true } }, rejectedBy: { select: { id: true, name: true } },
  member: { select: { id: true, name: true, code: true, email: true, phone: true, shop: { select: { id: true, name: true, status: true, shopLevel: { select: levelSelect } } } } },
  shopLevel: { select: levelSelect }, payments: { select: paymentSelect, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] },
} satisfies Prisma.ShopUpgradeRequestSelect;
type Selected = Prisma.ShopUpgradeRequestGetPayload<{ select: typeof select }>;
type SelectedPayment = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;
export type ShopUpgradeRequestRecord = Omit<Selected, 'payments'> & { payments: Array<SelectedPayment & { structurallyMatches: boolean }> };
export type ShopUpgradeRequestPage = { records: ShopUpgradeRequestRecord[]; total: number };
export type ShopUpgradeRequestQuery = { memberName?: string; memberCode?: string; shopLevelId?: number; status?: MemberRequestStatus; createdAt?: { start: Date; end: Date }; limit: number; offset: number };
export type ShopUpgradeDecisionResult = { changed: boolean; request: ShopUpgradeRequestRecord };
export interface ShopUpgradeRequestRepository {
  findPage(query: ShopUpgradeRequestQuery): Promise<ShopUpgradeRequestPage>;
  findById(id: number): Promise<ShopUpgradeRequestRecord | null>;
  findPaymentProofContext(requestId: number, paymentId: number): Promise<{ attachment: string } | null>;
  approve(input: { requestId: number; paymentId: number; actorUserId: number }): Promise<ShopUpgradeDecisionResult>;
  reject(input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<ShopUpgradeDecisionResult>;
}

const paymentMatches = (request: Pick<Selected, 'id' | 'memberId' | 'shopLevelId'>, payment: SelectedPayment) =>
  payment.shopUpgradeRequestId === request.id && payment.memberId === request.memberId && payment.requestType === PaymentRequestType.SHOP_LEVEL_UPGRADE
  && payment.shopLevelId === request.shopLevelId && payment.memberPlanId === null && payment.memberTypeId === null && payment.memberRequestId === null;
const toRecord = (record: Selected): ShopUpgradeRequestRecord => ({ ...record, payments: record.payments.map((payment) => ({ ...payment, structurallyMatches: paymentMatches(record, payment) })) });
const whereFor = (query: ShopUpgradeRequestQuery): Prisma.ShopUpgradeRequestWhereInput => ({
  ...(query.memberName || query.memberCode ? { member: {
    ...(query.memberName ? { name: { contains: query.memberName, mode: 'insensitive' as const } } : {}),
    ...(query.memberCode ? { code: { contains: query.memberCode, mode: 'insensitive' as const } } : {}),
  } } : {}),
  ...(query.shopLevelId ? { shopLevelId: query.shopLevelId } : {}), ...(query.status ? { status: query.status } : {}),
  ...(query.createdAt ? { createdAt: { gte: query.createdAt.start, lt: query.createdAt.end } } : {}),
});
const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Shop upgrade request was not found.' });
const relationshipConflict = () => new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_PAYMENT_RELATIONSHIP_INVALID', message: 'Selected payment does not match this shop upgrade request.' });
const requestConflict = (status: MemberRequestStatus) => new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_REQUEST_STATE_CONFLICT', message: 'Shop upgrade request has already received the opposite terminal decision.', details: { status } });
const paymentConflict = (status: PaymentStatus) => new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_PAYMENT_STATE_CONFLICT', message: 'Selected payment is not compatible with this decision.', details: { status } });
const shopNotFound = () => new AppError({ statusCode: 404, code: 'SHOP_NOT_FOUND', message: 'The member-owned Shop was not found.' });
const selectedPayment = async (transaction: Prisma.TransactionClient, request: Selected, paymentId: number) => {
  const payment = await transaction.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
  if (!payment || !paymentMatches(request, payment)) throw relationshipConflict();
  if (!request.member.shop) throw shopNotFound();
  return payment;
};

export class PrismaShopUpgradeRequestRepository implements ShopUpgradeRequestRepository {
  public async findPage(query: ShopUpgradeRequestQuery): Promise<ShopUpgradeRequestPage> { const prisma = getPrismaClient(); const where = whereFor(query); const [records, total] = await prisma.$transaction([prisma.shopUpgradeRequest.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }), prisma.shopUpgradeRequest.count({ where })]); return { records: records.map(toRecord), total }; }
  public async findById(id: number): Promise<ShopUpgradeRequestRecord | null> { const record = await getPrismaClient().shopUpgradeRequest.findUnique({ where: { id }, select }); return record ? toRecord(record) : null; }
  public async findPaymentProofContext(requestId: number, paymentId: number): Promise<{ attachment: string } | null> {
    const prisma = getPrismaClient(); const [request, payment] = await prisma.$transaction([prisma.shopUpgradeRequest.findUnique({ where: { id: requestId }, select: { id: true, memberId: true, shopLevelId: true, member: { select: { shop: { select: { id: true } } } } } }), prisma.payment.findUnique({ where: { id: paymentId }, select: paymentSelect })]);
    return request && request.member.shop && payment && paymentMatches(request, payment) ? { attachment: payment.attachment } : null;
  }
  public approve(input: { requestId: number; paymentId: number; actorUserId: number }): Promise<ShopUpgradeDecisionResult> { const prisma = getPrismaClient(); return runWithSerializableRetry(() => prisma.$transaction((tx) => this.approveTx(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })); }
  public reject(input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<ShopUpgradeDecisionResult> { const prisma = getPrismaClient(); return runWithSerializableRetry(() => prisma.$transaction((tx) => this.rejectTx(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })); }
  private async approveTx(transaction: Prisma.TransactionClient, input: { requestId: number; paymentId: number; actorUserId: number }): Promise<ShopUpgradeDecisionResult> {
    const request = await transaction.shopUpgradeRequest.findUnique({ where: { id: input.requestId }, select }); if (!request) throw notFound();
    const payment = await selectedPayment(transaction, request, input.paymentId);
    if (request.status === MemberRequestStatus.REJECTED) throw requestConflict(request.status);
    if (payment.status === PaymentStatus.DECLINE) throw new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_PAYMENT_DECLINED', message: 'A declined payment cannot approve a shop upgrade request.' });
    if (request.status === MemberRequestStatus.APPROVED) { if (payment.status !== PaymentStatus.ACCEPT) throw paymentConflict(payment.status); return { changed: false, request: toRecord(request) }; }
    const newest = await transaction.shopUpgradeRequest.findFirst({ where: { memberId: request.memberId }, select: { id: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (newest?.id !== request.id) throw new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_REQUEST_NOT_LATEST', message: 'Only the member\'s newest shop upgrade request can be approved.' });
    const shop = request.member.shop!; if (shop.status !== Status.ACTIVE) throw new AppError({ statusCode: 409, code: 'SHOP_INACTIVE', message: 'The member-owned Shop is inactive.' });
    if (request.shopLevel.status !== Status.ACTIVE) throw new AppError({ statusCode: 409, code: 'SHOP_LEVEL_INACTIVE', message: 'The requested ShopLevel is inactive.' });
    if (request.shopLevel.postLimit <= 0) throw new AppError({ statusCode: 409, code: 'SHOP_LEVEL_CONFIGURATION_INVALID', message: 'The requested ShopLevel has an invalid post limit.' });
    const now = new Date();
    if (payment.status === PaymentStatus.DRAFT) { const changed = await transaction.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.DRAFT }, data: { status: PaymentStatus.ACCEPT, approvedById: input.actorUserId, approvedAt: now, cancelledById: null, cancelledAt: null, cancelledReason: null } }); if (changed.count !== 1) throw paymentConflict((await transaction.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status); }
    const approved = await transaction.shopUpgradeRequest.updateMany({ where: { id: request.id, status: MemberRequestStatus.PENDING }, data: { status: MemberRequestStatus.APPROVED, postCount: request.shopLevel.postLimit, approvedById: input.actorUserId, approvedAt: now, rejectedById: null, rejectedAt: null, rejectedReason: null } }); if (approved.count !== 1) throw requestConflict((await transaction.shopUpgradeRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } })).status);
    const shopUpdated = await transaction.shop.updateMany({ where: { id: shop.id, memberId: request.memberId, status: Status.ACTIVE }, data: { shopLevelId: request.shopLevelId, updatedById: input.actorUserId } }); if (shopUpdated.count !== 1) throw new AppError({ statusCode: 409, code: 'SHOP_INACTIVE', message: 'The member-owned Shop could not be updated.' });
    await transaction.notification.create({ data: { title: 'Shop upgrade request approved', message: 'Your shop upgrade request has been approved.', createUidId: null, toUserId: request.memberId, model: 'system', resId: request.id, isTrainerChat: false, type: NotificationType.SYSTEM, isSeen: false, isRead: false } });
    return { changed: true, request: toRecord(await transaction.shopUpgradeRequest.findUniqueOrThrow({ where: { id: request.id }, select })) };
  }
  private async rejectTx(transaction: Prisma.TransactionClient, input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<ShopUpgradeDecisionResult> {
    const request = await transaction.shopUpgradeRequest.findUnique({ where: { id: input.requestId }, select }); if (!request) throw notFound();
    const payment = await selectedPayment(transaction, request, input.paymentId);
    if (request.status === MemberRequestStatus.APPROVED) throw requestConflict(request.status);
    if (payment.status === PaymentStatus.ACCEPT) throw new AppError({ statusCode: 409, code: 'SHOP_UPGRADE_PAYMENT_ACCEPTED', message: 'An accepted payment cannot be reversed by rejecting a shop upgrade request.' });
    if (request.status === MemberRequestStatus.REJECTED) { if (payment.status !== PaymentStatus.DECLINE) throw paymentConflict(payment.status); return { changed: false, request: toRecord(request) }; }
    const now = new Date();
    if (payment.status === PaymentStatus.DRAFT) { const changed = await transaction.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.DRAFT }, data: { status: PaymentStatus.DECLINE, cancelledById: input.actorUserId, cancelledAt: now, cancelledReason: input.reason, approvedById: null, approvedAt: null } }); if (changed.count !== 1) throw paymentConflict((await transaction.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status); }
    const rejected = await transaction.shopUpgradeRequest.updateMany({ where: { id: request.id, status: MemberRequestStatus.PENDING }, data: { status: MemberRequestStatus.REJECTED, rejectedById: input.actorUserId, rejectedAt: now, rejectedReason: input.reason, approvedById: null, approvedAt: null } }); if (rejected.count !== 1) throw requestConflict((await transaction.shopUpgradeRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } })).status);
    await transaction.notification.create({ data: { title: 'Shop upgrade request rejected', message: 'Your shop upgrade request has been rejected.', createUidId: null, toUserId: request.memberId, model: 'system', resId: request.id, isTrainerChat: false, type: NotificationType.SYSTEM, isSeen: false, isRead: false } });
    return { changed: true, request: toRecord(await transaction.shopUpgradeRequest.findUniqueOrThrow({ where: { id: request.id }, select })) };
  }
}
