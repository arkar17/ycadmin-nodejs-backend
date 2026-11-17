import type { MemberRequestStatus, Prisma } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

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
  payments: { id: number; status: string; amount: number; requestDate: Date | null; hasProof: boolean }[];
};
export type MembershipRequestPage = { records: MembershipRequestRecord[]; total: number };
export type MembershipRequestRepositoryQuery = { memberName?: string; memberPlanId?: number; status?: MemberRequestStatus; createdAt?: { start: Date; end: Date }; limit: number; offset: number };

export interface MembershipRequestRepository {
  findPage(query: MembershipRequestRepositoryQuery): Promise<MembershipRequestPage>;
  findById(id: number): Promise<MembershipRequestRecord | null>;
}

const select = {
  id: true, name: true, status: true, rejectedReason: true, approvedAt: true, rejectedAt: true, createdAt: true,
  member: { select: { id: true, name: true, code: true } },
  memberType: { select: { id: true, name: true } },
  memberPlan: { select: { id: true, name: true, price: true, duration: true, planDuration: { select: { id: true, name: true, value: true } } } },
  payments: { select: { id: true, status: true, amount: true, requestDate: true, attachment: true }, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] },
};

const whereFor = (query: MembershipRequestRepositoryQuery): Prisma.MemberRequestWhereInput => ({
  ...(query.memberName ? { member: { is: { name: { contains: query.memberName, mode: 'insensitive' } } } } : {}),
  ...(query.memberPlanId ? { memberPlanId: query.memberPlanId } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.createdAt ? { createdAt: { gte: query.createdAt.start, lt: query.createdAt.end } } : {}),
});

const toRecord = (record: Prisma.MemberRequestGetPayload<{ select: typeof select }>): MembershipRequestRecord => ({
  ...record,
  payments: record.payments.map(({ attachment, ...payment }) => ({ ...payment, hasProof: attachment.trim().length > 0 })),
});

export class PrismaMembershipRequestRepository implements MembershipRequestRepository {
  public async findPage(query: MembershipRequestRepositoryQuery): Promise<MembershipRequestPage> {
    const prisma = getPrismaClient(); const where = whereFor(query);
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
}
