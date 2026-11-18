import {
  MemberRequestStatus,
  NotificationType,
  PaymentRequestType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { AppError } from '../../shared/app-error.js';
import { runWithSerializableRetry } from '../admin-rbac/serializable-transaction.js';

export type MembershipRequestPaymentRecord = {
  id: number;
  status: PaymentStatus;
  amount: number;
  requestDate: Date | null;
  hasProof: boolean;
  bankInformation: { id: number; name: string; paymentTypes: string };
  structurallyMatches: boolean;
  attachment: string;
};

export type MembershipPaymentProofContext = {
  attachment: string;
};

export type MembershipRequestRecord = {
  id: number;
  name: string | null;
  status: MemberRequestStatus;
  rejectedReason: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  member: { id: number; name: string; code: string };
  memberType: { id: number; name: string };
  memberPlan: { id: number; name: string; price: number; duration: number; planDuration: { id: number; name: string; value: number } | null };
  payments: MembershipRequestPaymentRecord[];
};
export type MembershipRequestPage = { records: MembershipRequestRecord[]; total: number };
export type MembershipRequestRepositoryQuery = { memberName?: string; memberPlanId?: number; status?: MemberRequestStatus; createdAt?: { start: Date; end: Date }; limit: number; offset: number };
export type MembershipRequestDecisionResult = { changed: boolean; request: MembershipRequestRecord };

export interface MembershipRequestRepository {
  findPage(query: MembershipRequestRepositoryQuery): Promise<MembershipRequestPage>;
  findById(id: number): Promise<MembershipRequestRecord | null>;
  findPaymentProofContext(requestId: number, paymentId: number): Promise<MembershipPaymentProofContext | null>;
  approve(input: { requestId: number; paymentId: number; actorUserId: number }): Promise<MembershipRequestDecisionResult>;
  reject(input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<MembershipRequestDecisionResult>;
}

const select = {
  id: true, name: true, status: true, rejectedReason: true, approvedAt: true, rejectedAt: true, createdAt: true,
  memberId: true, memberTypeId: true, memberPlanId: true,
  age: true, gender: true, yearOfExp: true, reason: true, certificates: true, photos: true,
  member: { select: { id: true, name: true, code: true } },
  memberType: { select: { id: true, name: true } },
  memberPlan: { select: { id: true, name: true, price: true, duration: true, memberTypeId: true, planDuration: { select: { id: true, name: true, value: true } } } },
  payments: {
    select: {
      id: true, memberId: true, requestType: true, memberPlanId: true, memberTypeId: true, memberRequestId: true,
      shopLevelId: true, shopUpgradeRequestId: true, status: true, amount: true, requestDate: true, attachment: true,
      bankInformation: { select: { id: true, name: true, paymentTypes: true } },
    },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.MemberRequestSelect;

type SelectedRequest = Prisma.MemberRequestGetPayload<{ select: typeof select }>;
type SelectedPayment = SelectedRequest['payments'][number];

const paymentMatches = (request: Pick<SelectedRequest, 'id' | 'memberId' | 'memberPlanId' | 'memberTypeId'>, payment: SelectedPayment): boolean =>
  payment.memberRequestId === request.id
  && payment.memberId === request.memberId
  && payment.requestType === PaymentRequestType.MEMBER_PLAN_UPGRADE
  && payment.memberPlanId === request.memberPlanId
  && payment.memberTypeId === request.memberTypeId
  && payment.shopLevelId === null
  && payment.shopUpgradeRequestId === null;

const toRecord = (record: SelectedRequest): MembershipRequestRecord => ({
  id: record.id,
  name: record.name,
  status: record.status,
  rejectedReason: record.rejectedReason,
  approvedAt: record.approvedAt,
  rejectedAt: record.rejectedAt,
  createdAt: record.createdAt,
  member: record.member,
  memberType: record.memberType,
  memberPlan: { id: record.memberPlan.id, name: record.memberPlan.name, price: record.memberPlan.price, duration: record.memberPlan.duration, planDuration: record.memberPlan.planDuration },
  payments: record.payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    requestDate: payment.requestDate,
    hasProof: payment.attachment.trim().length > 0,
    bankInformation: payment.bankInformation,
    structurallyMatches: paymentMatches(record, payment),
    attachment: payment.attachment,
  })),
});

const whereFor = (query: MembershipRequestRepositoryQuery): Prisma.MemberRequestWhereInput => ({
  ...(query.memberName ? { member: { is: { name: { contains: query.memberName, mode: 'insensitive' } } } } : {}),
  ...(query.memberPlanId ? { memberPlanId: query.memberPlanId } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.createdAt ? { createdAt: { gte: query.createdAt.start, lt: query.createdAt.end } } : {}),
});

const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Membership request was not found.' });
const requestConflict = (status: MemberRequestStatus) => new AppError({ statusCode: 409, code: 'MEMBERSHIP_REQUEST_STATE_CONFLICT', message: 'Membership request has already received the opposite terminal decision.', details: { status } });
const relationshipConflict = () => new AppError({ statusCode: 409, code: 'MEMBERSHIP_PAYMENT_RELATIONSHIP_INVALID', message: 'Selected payment does not match this membership request.' });
const paymentStateConflict = (status: PaymentStatus) => new AppError({ statusCode: 409, code: 'MEMBERSHIP_PAYMENT_STATE_CONFLICT', message: 'Selected payment is not in a state compatible with this decision.', details: { status } });

const selectedPayment = async (transaction: Prisma.TransactionClient, request: SelectedRequest, paymentId: number): Promise<SelectedPayment> => {
  const payment = await transaction.payment.findUnique({ where: { id: paymentId }, select: select.payments.select });
  if (!payment || !paymentMatches(request, payment)) throw relationshipConflict();
  if (request.memberPlan.memberTypeId !== request.memberTypeId) throw relationshipConflict();
  return payment;
};

const trainerProfileData = (request: SelectedRequest): Prisma.MemberProfileUncheckedCreateInput | null => {
  // Mobile requires these four fields for Trainer requests and accepts only
  // memberPlanId for Gym requests. This request shape avoids numeric IDs and
  // mutable MemberType names in a schema that has no semantic type key.
  if (request.age === null || request.gender === null || request.yearOfExp === null || request.reason === null) return null;
  return {
    memberId: request.memberId,
    age: request.age,
    gender: request.gender,
    yearOfExp: request.yearOfExp,
    reason: request.reason,
    ...(request.certificates === null ? {} : { certificates: request.certificates as Prisma.InputJsonValue }),
    ...(request.photos === null ? {} : { photos: request.photos as Prisma.InputJsonValue }),
  };
};

export class PrismaMembershipRequestRepository implements MembershipRequestRepository {
  public async findPage(query: MembershipRequestRepositoryQuery): Promise<MembershipRequestPage> {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [records, total] = await prisma.$transaction([
      prisma.memberRequest.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.memberRequest.count({ where }),
    ]);
    return { records: records.map(toRecord), total };
  }

  public async findById(id: number): Promise<MembershipRequestRecord | null> {
    const record = await getPrismaClient().memberRequest.findUnique({ where: { id }, select });
    return record ? toRecord(record) : null;
  }

  public async findPaymentProofContext(requestId: number, paymentId: number): Promise<MembershipPaymentProofContext | null> {
    const prisma = getPrismaClient();
    const [request, payment] = await prisma.$transaction([
      prisma.memberRequest.findUnique({
        where: { id: requestId },
        select: { id: true, memberId: true, memberPlanId: true, memberTypeId: true, memberPlan: { select: { memberTypeId: true } } },
      }),
      prisma.payment.findUnique({ where: { id: paymentId }, select: select.payments.select }),
    ]);
    if (!request || !payment || request.memberPlan.memberTypeId !== request.memberTypeId || !paymentMatches(request, payment)) return null;
    return { attachment: payment.attachment };
  }

  public approve(input: { requestId: number; paymentId: number; actorUserId: number }): Promise<MembershipRequestDecisionResult> {
    const prisma = getPrismaClient();
    return runWithSerializableRetry(() => prisma.$transaction((transaction) => this.approveInTransaction(transaction, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  public reject(input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<MembershipRequestDecisionResult> {
    const prisma = getPrismaClient();
    return runWithSerializableRetry(() => prisma.$transaction((transaction) => this.rejectInTransaction(transaction, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  }

  private async approveInTransaction(transaction: Prisma.TransactionClient, input: { requestId: number; paymentId: number; actorUserId: number }): Promise<MembershipRequestDecisionResult> {
    const request = await transaction.memberRequest.findUnique({ where: { id: input.requestId }, select });
    if (!request) throw notFound();
    const payment = await selectedPayment(transaction, request, input.paymentId);
    if (request.status === MemberRequestStatus.REJECTED) throw requestConflict(request.status);
    if (payment.status === PaymentStatus.DECLINE) throw new AppError({ statusCode: 409, code: 'MEMBERSHIP_PAYMENT_DECLINED', message: 'A declined payment cannot approve a membership request.' });
    if (request.status === MemberRequestStatus.APPROVED) {
      if (payment.status !== PaymentStatus.ACCEPT) throw paymentStateConflict(payment.status);
      return { changed: false, request: toRecord(request) };
    }

    const now = new Date();
    if (payment.status === PaymentStatus.DRAFT) {
      const accepted = await transaction.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.DRAFT }, data: { status: PaymentStatus.ACCEPT, approvedById: input.actorUserId, approvedAt: now, cancelledById: null, cancelledAt: null, cancelledReason: null } });
      if (accepted.count !== 1) throw paymentStateConflict((await transaction.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status);
    }
    const approved = await transaction.memberRequest.updateMany({ where: { id: request.id, status: MemberRequestStatus.PENDING }, data: { status: MemberRequestStatus.APPROVED, approvedById: input.actorUserId, approvedAt: now, rejectedById: null, rejectedAt: null, rejectedReason: null } });
    if (approved.count !== 1) throw requestConflict((await transaction.memberRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } })).status);

    await transaction.member.update({ where: { id: request.memberId }, data: { memberTypeId: request.memberTypeId, updatedById: input.actorUserId } });
    const profile = trainerProfileData(request);
    if (profile) {
      const { memberId, ...profileFields } = profile;
      await transaction.memberProfile.upsert({ where: { memberId }, create: profile, update: profileFields });
    }
    await transaction.notification.create({ data: { title: 'Membership request approved', message: 'Your membership request has been approved.', createUidId: null, toUserId: request.memberId, model: 'system', resId: request.id, isTrainerChat: false, type: NotificationType.SYSTEM, isSeen: false, isRead: false } });
    const finalRequest = await transaction.memberRequest.findUniqueOrThrow({ where: { id: request.id }, select });
    return { changed: true, request: toRecord(finalRequest) };
  }

  private async rejectInTransaction(transaction: Prisma.TransactionClient, input: { requestId: number; paymentId: number; actorUserId: number; reason: string }): Promise<MembershipRequestDecisionResult> {
    const request = await transaction.memberRequest.findUnique({ where: { id: input.requestId }, select });
    if (!request) throw notFound();
    const payment = await selectedPayment(transaction, request, input.paymentId);
    if (request.status === MemberRequestStatus.APPROVED) throw requestConflict(request.status);
    if (payment.status === PaymentStatus.ACCEPT) throw new AppError({ statusCode: 409, code: 'MEMBERSHIP_PAYMENT_ACCEPTED', message: 'An accepted payment cannot be reversed by rejecting a membership request.' });
    if (request.status === MemberRequestStatus.REJECTED) {
      if (payment.status !== PaymentStatus.DECLINE) throw paymentStateConflict(payment.status);
      return { changed: false, request: toRecord(request) };
    }

    const now = new Date();
    if (payment.status === PaymentStatus.DRAFT) {
      const declined = await transaction.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.DRAFT }, data: { status: PaymentStatus.DECLINE, cancelledById: input.actorUserId, cancelledAt: now, cancelledReason: input.reason, approvedById: null, approvedAt: null } });
      if (declined.count !== 1) throw paymentStateConflict((await transaction.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } })).status);
    }
    const rejected = await transaction.memberRequest.updateMany({ where: { id: request.id, status: MemberRequestStatus.PENDING }, data: { status: MemberRequestStatus.REJECTED, rejectedById: input.actorUserId, rejectedAt: now, rejectedReason: input.reason, approvedById: null, approvedAt: null } });
    if (rejected.count !== 1) throw requestConflict((await transaction.memberRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true } })).status);
    await transaction.notification.create({ data: { title: 'Membership request rejected', message: 'Your membership request has been rejected.', createUidId: null, toUserId: request.memberId, model: 'system', resId: request.id, isTrainerChat: false, type: NotificationType.SYSTEM, isSeen: false, isRead: false } });
    const finalRequest = await transaction.memberRequest.findUniqueOrThrow({ where: { id: request.id }, select });
    return { changed: true, request: toRecord(finalRequest) };
  }
}
