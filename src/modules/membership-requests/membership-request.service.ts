import { AppError } from '../../shared/app-error.js';
import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { MembershipRequestListQuery } from './membership-request.schema.js';
import type { MembershipRequestRecord, MembershipRequestRepository } from './membership-request.repository.js';

export type MembershipRequestItem = {
  id: number; requestName: string | null; status: string; requestedAt: string; approvedAt: string | null; rejectedAt: string | null;
  member: { id: number; name: string; clientCode: string };
  memberType: { id: number; name: string };
  memberPlan: { id: number; name: string; currentPrice: number; durationMonths: number; duration: { id: number; name: string; value: number } | null };
  payments: { id: number; status: string; amount: number; requestedAt: string | null; proofAvailable: boolean }[];
};
export type MembershipRequestDetail = MembershipRequestItem & { rejectedReason: string | null };

export class MembershipRequestService {
  public constructor(private readonly repository: MembershipRequestRepository) {}
  public async list(query: MembershipRequestListQuery): Promise<{ data: MembershipRequestItem[]; total: number }> {
    const page = await this.repository.findPage({ memberName: query.memberName, memberPlanId: query.memberPlanId, status: query.status, ...(query.date ? { createdAt: yangonDateToUtcRange(query.date) } : {}), limit: query.limit, offset: query.offset });
    return { data: page.records.map(this.toItem), total: page.total };
  }
  public async detail(id: number): Promise<MembershipRequestDetail> {
    const request = await this.repository.findById(id);
    if (!request) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Membership request was not found.' });
    return { ...this.toItem(request), rejectedReason: request.rejectedReason };
  }
  private readonly toItem = (record: MembershipRequestRecord): MembershipRequestItem => ({
    id: record.id, requestName: record.name, status: record.status, requestedAt: record.createdAt.toISOString(), approvedAt: record.approvedAt?.toISOString() ?? null, rejectedAt: record.rejectedAt?.toISOString() ?? null,
    member: { id: record.member.id, name: record.member.name, clientCode: record.member.code }, memberType: record.memberType,
    memberPlan: { id: record.memberPlan.id, name: record.memberPlan.name, currentPrice: record.memberPlan.price, durationMonths: record.memberPlan.duration, duration: record.memberPlan.planDuration },
    payments: record.payments.map((payment) => ({ id: payment.id, status: payment.status, amount: payment.amount, requestedAt: payment.requestDate?.toISOString() ?? null, proofAvailable: payment.hasProof })),
  });
}
