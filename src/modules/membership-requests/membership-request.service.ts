import { AppError } from '../../shared/app-error.js';
import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { MembershipRequestListQuery } from './membership-request.schema.js';
import type { MembershipRequestRecord, MembershipRequestRepository } from './membership-request.repository.js';
import type { MembershipPaymentProofService } from './payment-proof.service.js';

export type MembershipRequestItem = {
  id: number; requestName: string | null; status: string; requestedAt: string; approvedAt: string | null; rejectedAt: string | null;
  member: { id: number; name: string; clientCode: string };
  memberType: { id: number; name: string };
  memberPlan: { id: number; name: string; currentPrice: number; durationMonths: number; duration: { id: number; name: string; value: number } | null };
  payments: {
    id: number;
    status: string;
    amount: number;
    requestedAt: string | null;
    hasPaymentProof: boolean;
    proofAvailable: boolean;
    paymentProofStatus: string;
    paymentProofPath?: string;
    paymentDestination: { id: number; name: string; paymentType: string };
    structurallyMatches: boolean;
  }[];
};
export type MembershipRequestDetail = MembershipRequestItem & { rejectedReason: string | null };

export class MembershipRequestService {
  public constructor(
    private readonly repository: MembershipRequestRepository,
    private readonly paymentProofService: MembershipPaymentProofService,
  ) {}
  public async list(query: MembershipRequestListQuery): Promise<{ data: MembershipRequestItem[]; total: number }> {
    const page = await this.repository.findPage({ memberName: query.memberName, memberPlanId: query.memberPlanId, status: query.status, ...(query.date ? { createdAt: yangonDateToUtcRange(query.date) } : {}), limit: query.limit, offset: query.offset });
    return { data: page.records.map(this.toItem), total: page.total };
  }
  public async detail(id: number): Promise<MembershipRequestDetail> {
    const request = await this.repository.findById(id);
    if (!request) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Membership request was not found.' });
    return { ...this.toItem(request), rejectedReason: request.rejectedReason };
  }
  public async approve(id: number, paymentId: number, actorUserId: number) {
    const result = await this.repository.approve({ requestId: id, paymentId, actorUserId });
    return { changed: result.changed, membershipRequest: { ...this.toItem(result.request), rejectedReason: result.request.rejectedReason } };
  }
  public async reject(id: number, paymentId: number, reason: string, actorUserId: number) {
    const result = await this.repository.reject({ requestId: id, paymentId, actorUserId, reason });
    return { changed: result.changed, membershipRequest: { ...this.toItem(result.request), rejectedReason: result.request.rejectedReason } };
  }
  public proof(requestId: number, paymentId: number): Promise<Buffer> {
    return this.paymentProofService.get(requestId, paymentId);
  }
  private readonly toItem = (record: MembershipRequestRecord): MembershipRequestItem => ({
    id: record.id, requestName: record.name, status: record.status, requestedAt: record.createdAt.toISOString(), approvedAt: record.approvedAt?.toISOString() ?? null, rejectedAt: record.rejectedAt?.toISOString() ?? null,
    member: { id: record.member.id, name: record.member.name, clientCode: record.member.code }, memberType: record.memberType,
    memberPlan: { id: record.memberPlan.id, name: record.memberPlan.name, currentPrice: record.memberPlan.price, durationMonths: record.memberPlan.duration, duration: record.memberPlan.planDuration },
    payments: record.payments.map((payment) => ({
      ...this.paymentProofService.describe(record.id, payment),
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      requestedAt: payment.requestDate?.toISOString() ?? null,
      hasPaymentProof: payment.hasProof,
      proofAvailable: payment.hasProof,
      paymentDestination: { id: payment.bankInformation.id, name: payment.bankInformation.name, paymentType: payment.bankInformation.paymentTypes },
      structurallyMatches: payment.structurallyMatches,
    })),
  });
}
