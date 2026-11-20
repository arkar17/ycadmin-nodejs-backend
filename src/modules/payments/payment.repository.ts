import {
  NotificationType,
  PaymentRequestType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';
import { AppError } from '../../shared/app-error.js';
import { runWithSerializableRetry } from '../admin-rbac/serializable-transaction.js';
import type { PaymentListQuery } from './payment.schema.js';
import type { PaymentProofContext } from '../payment-proof/payment-proof.service.js';

const paymentSelect = {
  id: true,
  name: true,
  memberId: true,
  requestType: true,
  memberPlanId: true,
  memberTypeId: true,
  shopLevelId: true,
  memberRequestId: true,
  shopUpgradeRequestId: true,
  amount: true,
  attachment: true,
  requestDate: true,
  status: true,
  approvedById: true,
  approvedAt: true,
  cancelledById: true,
  cancelledAt: true,
  cancelledReason: true,
  createdAt: true,
  updatedAt: true,
  member: { select: { id: true, name: true, code: true } },
  memberPlan: { select: { id: true, name: true } },
  memberType: { select: { id: true, name: true } },
  shopLevel: { select: { id: true, name: true } },
  bankInformation: { select: { id: true, name: true, paymentTypes: true } },
  approvedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  memberRequest: {
    select: { id: true, status: true, memberId: true, memberPlanId: true, memberTypeId: true },
  },
  shopUpgradeRequest: {
    select: { id: true, status: true, memberId: true, shopLevelId: true, postCount: true },
  },
} satisfies Prisma.PaymentSelect;

type SelectedPayment = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;
export type PaymentRecord = Omit<SelectedPayment, 'attachment'> & {
  hasPaymentProof: boolean;
  /** Internal only. DTO mappers must never return this stored value. */
  paymentProofAttachment: string;
};
export type PaymentPage = { records: PaymentRecord[]; total: number };
export type PaymentDecision = 'accept' | 'decline';
export type PaymentDecisionResult = {
  changed: boolean;
  payment: PaymentRecord;
  pushTarget: { token: string; title: string; message: string } | null;
};

export interface PaymentRepository {
  findPage(query: PaymentListQuery): Promise<PaymentPage>;
  findById(id: number): Promise<PaymentRecord | null>;
  findPaymentProofContext(id: number): Promise<PaymentProofContext | null>;
  decide(input: { paymentId: number; actorUserId: number; decision: PaymentDecision; reason?: string }): Promise<PaymentDecisionResult>;
}

const toRecord = ({ attachment, ...payment }: SelectedPayment): PaymentRecord => ({
  ...payment,
  hasPaymentProof: attachment.trim().length > 0,
  paymentProofAttachment: attachment,
});

const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Payment was not found.' });
const stateConflict = (status: PaymentStatus) => new AppError({
  statusCode: 409,
  code: 'PAYMENT_STATE_CONFLICT',
  message: 'Payment has already received the opposite terminal decision.',
  details: { status },
});
const managedByRequest = () => new AppError({
  statusCode: 409,
  code: 'PAYMENT_MANAGED_BY_REQUEST',
  message: 'This payment must be decided through its owning request.',
});

const relationshipIssues = (payment: SelectedPayment): string[] => {
  if (payment.requestType === PaymentRequestType.MEMBER_PLAN_UPGRADE) {
    return [
      ...(payment.memberPlanId === null ? ['memberPlanId is required'] : []),
      ...(payment.memberTypeId === null ? ['memberTypeId is required'] : []),
      ...(payment.shopLevelId !== null ? ['shopLevelId must be null'] : []),
      ...(payment.shopUpgradeRequestId !== null ? ['shopUpgradeRequestId must be null'] : []),
      ...(payment.memberRequest && payment.memberRequest.memberId !== payment.memberId ? ['MemberRequest belongs to another Member'] : []),
      ...(payment.memberRequest && payment.memberRequest.memberPlanId !== payment.memberPlanId ? ['MemberRequest plan does not match'] : []),
      ...(payment.memberRequest && payment.memberRequest.memberTypeId !== payment.memberTypeId ? ['MemberRequest type does not match'] : []),
    ];
  }

  return [
    ...(payment.shopLevelId === null ? ['shopLevelId is required'] : []),
    ...(payment.memberPlanId !== null ? ['memberPlanId must be null'] : []),
    ...(payment.memberTypeId !== null ? ['memberTypeId must be null'] : []),
    ...(payment.memberRequestId !== null ? ['memberRequestId must be null'] : []),
    ...(payment.shopUpgradeRequest && payment.shopUpgradeRequest.memberId !== payment.memberId ? ['ShopUpgradeRequest belongs to another Member'] : []),
    ...(payment.shopUpgradeRequest && payment.shopUpgradeRequest.shopLevelId !== payment.shopLevelId ? ['ShopUpgradeRequest level does not match'] : []),
  ];
};

const assertDecisionRelationships = (payment: SelectedPayment): void => {
  const issues = relationshipIssues(payment);
  if (issues.length > 0) {
    throw new AppError({
      statusCode: 409,
      code: 'PAYMENT_RELATIONSHIP_INVALID',
      message: 'Payment relationships are inconsistent with its request type.',
      details: { issues },
    });
  }
};

const whereFor = (query: PaymentListQuery): Prisma.PaymentWhereInput => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.requestType ? { requestType: query.requestType } : {}),
  ...(query.memberId ? { memberId: query.memberId } : {}),
  ...(query.memberPlanId ? { memberPlanId: query.memberPlanId } : {}),
  ...(query.memberTypeId ? { memberTypeId: query.memberTypeId } : {}),
  ...(query.shopLevelId ? { shopLevelId: query.shopLevelId } : {}),
  ...(query.minAmount !== undefined || query.maxAmount !== undefined
    ? { amount: { ...(query.minAmount !== undefined ? { gte: query.minAmount } : {}), ...(query.maxAmount !== undefined ? { lte: query.maxAmount } : {}) } }
    : {}),
});

export class PrismaPaymentRepository implements PaymentRepository {
  public async findPage(query: PaymentListQuery): Promise<PaymentPage> {
    const prisma = getPrismaClient();
    const where = whereFor(query);
    const [records, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        select: paymentSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
      prisma.payment.count({ where }),
    ]);
    return { records: records.map(toRecord), total };
  }

  public async findById(id: number): Promise<PaymentRecord | null> {
    const payment = await getPrismaClient().payment.findUnique({ where: { id }, select: paymentSelect });
    return payment ? toRecord(payment) : null;
  }

  public async findPaymentProofContext(id: number): Promise<PaymentProofContext | null> {
    return getPrismaClient().payment.findUnique({ where: { id }, select: { attachment: true } });
  }

  public decide(input: { paymentId: number; actorUserId: number; decision: PaymentDecision; reason?: string }): Promise<PaymentDecisionResult> {
    const prisma = getPrismaClient();
    return runWithSerializableRetry(() => prisma.$transaction(
      (transaction) => this.decideInTransaction(transaction, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ));
  }

  private async decideInTransaction(
    transaction: Prisma.TransactionClient,
    input: { paymentId: number; actorUserId: number; decision: PaymentDecision; reason?: string },
  ): Promise<PaymentDecisionResult> {
    const desiredStatus = input.decision === 'accept' ? PaymentStatus.ACCEPT : PaymentStatus.DECLINE;
    const message = input.decision === 'accept'
      ? 'Your payment has been accepted.'
      : 'Your payment has been declined.';
    const current = await transaction.payment.findUnique({ where: { id: input.paymentId }, select: paymentSelect });
    if (!current) throw notFound();
    if (current.memberRequestId !== null || current.shopUpgradeRequestId !== null) throw managedByRequest();
    if (current.status === desiredStatus) return { changed: false, payment: toRecord(current), pushTarget: null };
    if (current.status !== PaymentStatus.DRAFT) throw stateConflict(current.status);
    assertDecisionRelationships(current);

    const updated = await transaction.payment.updateMany({
      where: { id: input.paymentId, status: PaymentStatus.DRAFT },
      data: input.decision === 'accept'
        ? {
            status: PaymentStatus.ACCEPT,
            approvedById: input.actorUserId,
            approvedAt: new Date(),
            cancelledById: null,
            cancelledAt: null,
            cancelledReason: null,
          }
        : {
            status: PaymentStatus.DECLINE,
            cancelledById: input.actorUserId,
            cancelledAt: new Date(),
            cancelledReason: input.reason!,
            approvedById: null,
            approvedAt: null,
          },
    });

    if (updated.count !== 1) {
      const winner = await transaction.payment.findUnique({ where: { id: input.paymentId }, select: paymentSelect });
      if (!winner) throw notFound();
      if (winner.status === desiredStatus) return { changed: false, payment: toRecord(winner), pushTarget: null };
      throw stateConflict(winner.status);
    }

    await transaction.notification.create({
      data: {
        title: message,
        message,
        createUidId: null,
        toUserId: current.memberId,
        model: 'system',
        resId: current.id,
        isTrainerChat: false,
        type: NotificationType.SYSTEM,
        isSeen: false,
        isRead: false,
      },
    });

    const [payment, fcmToken] = await Promise.all([
      transaction.payment.findUniqueOrThrow({ where: { id: input.paymentId }, select: paymentSelect }),
      transaction.memberFcmToken.findUnique({ where: { memberId: current.memberId }, select: { token: true } }),
    ]);
    return {
      changed: true,
      payment: toRecord(payment),
      pushTarget: fcmToken ? { token: fcmToken.token, title: message, message } : null,
    };
  }
}
