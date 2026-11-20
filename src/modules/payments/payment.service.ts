import type { Logger } from 'pino';

import { AppError } from '../../shared/app-error.js';
import type { PaymentPushNotificationService } from './payment-push.service.js';
import type { PaymentDecision, PaymentRecord, PaymentRepository } from './payment.repository.js';
import type { PaymentListQuery } from './payment.schema.js';
import type { PaymentProofService } from './payment-proof.service.js';

const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Payment was not found.' });

export class PaymentService {
  public constructor(
    private readonly repository: PaymentRepository,
    private readonly pushNotifications: PaymentPushNotificationService,
    private readonly log: Pick<Logger, 'warn'>,
    private readonly paymentProof: PaymentProofService,
  ) {}

  public async list(query: PaymentListQuery) {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toListItem), total: page.total };
  }

  public async detail(id: number) {
    const payment = await this.repository.findById(id);
    if (!payment) throw notFound();
    return this.toDetail(payment);
  }

  public proof(id: number): Promise<Buffer> {
    return this.paymentProof.get(id);
  }

  public accept(paymentId: number, actorUserId: number, requestId: string) {
    return this.decide('accept', paymentId, actorUserId, requestId);
  }

  public decline(paymentId: number, actorUserId: number, reason: string, requestId: string) {
    return this.decide('decline', paymentId, actorUserId, requestId, reason);
  }

  private async decide(
    decision: PaymentDecision,
    paymentId: number,
    actorUserId: number,
    requestId: string,
    reason?: string,
  ) {
    const result = await this.repository.decide({ paymentId, actorUserId, decision, ...(reason ? { reason } : {}) });
    if (result.changed && result.pushTarget) {
      try {
        await this.pushNotifications.send({
          ...result.pushTarget,
          paymentId: result.payment.id,
          memberId: result.payment.memberId,
        });
      } catch (error) {
        this.log.warn({
          failureType: error instanceof Error ? error.name : 'UnknownError',
          requestId,
          paymentId,
          memberId: result.payment.memberId,
        }, 'Payment push delivery failed after commit');
      }
    }
    return { changed: result.changed, payment: this.toDetail(result.payment) };
  }

  private readonly toListItem = (payment: PaymentRecord) => ({
    id: payment.id,
    name: payment.name,
    member: payment.member,
    requestType: payment.requestType,
    memberPlan: payment.memberPlan,
    memberType: payment.memberType,
    shopLevel: payment.shopLevel,
    amount: payment.amount,
    requestDate: payment.requestDate?.toISOString() ?? null,
    status: payment.status,
    approval: payment.approvedAt ? { by: payment.approvedBy, at: payment.approvedAt.toISOString() } : null,
    decline: payment.cancelledAt ? { by: payment.cancelledBy, at: payment.cancelledAt.toISOString(), reason: payment.cancelledReason } : null,
    ...this.paymentProof.describe(payment),
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  });

  private readonly toDetail = (payment: PaymentRecord) => ({
    ...this.toListItem(payment),
    bankInformation: payment.bankInformation,
    memberRequest: payment.memberRequest
      ? { id: payment.memberRequest.id, status: payment.memberRequest.status }
      : null,
    shopUpgradeRequest: payment.shopUpgradeRequest
      ? { id: payment.shopUpgradeRequest.id, status: payment.shopUpgradeRequest.status, postCount: payment.shopUpgradeRequest.postCount }
      : null,
  });
}
