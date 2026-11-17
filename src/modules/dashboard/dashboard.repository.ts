import { MemberRequestStatus, Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type DashboardRange = { start: Date; end: Date; granularity: 'day' | 'month' };
export type DashboardAggregate = {
  totalRegistered: number;
  activeRegistered: number;
  inactiveRegistered: number;
  newRegistered: number;
  attendanceRecords: number;
  distinctAttendanceMembers: number;
  pendingRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  newRequests: number;
};
export type DashboardTrendPoint = { bucket: string; registrations: number; attendance: number; membershipRequests: number };

export interface DashboardRepository {
  aggregate(range: DashboardRange): Promise<DashboardAggregate>;
  trends(range: DashboardRange): Promise<DashboardTrendPoint[]>;
}

type CountRow = { count: bigint | number };
type BucketRow = { bucket: string; count: bigint | number };

const toNumber = (value: bigint | number): number => Number(value);
const groupedCount = (value: unknown): number =>
  typeof value === 'object' && value !== null && '_all' in value && typeof value._all === 'number' ? value._all : 0;

const bucketExpression = (granularity: DashboardRange['granularity']) =>
  granularity === 'day'
    ? Prisma.sql`to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Yangon', 'YYYY-MM-DD')`
    : Prisma.sql`to_char(date_trunc('month', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Yangon'), 'YYYY-MM')`;

export class PrismaDashboardRepository implements DashboardRepository {
  public async aggregate(range: DashboardRange): Promise<DashboardAggregate> {
    const prisma = getPrismaClient();
    const [totalRegistered, memberStatuses, newRegistered, attendanceRecords, distinctAttendanceRows, requestStatuses, newRequests] = await prisma.$transaction([
      prisma.member.count(),
      prisma.member.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      prisma.member.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
      prisma.attendance.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
      prisma.$queryRaw<CountRow[]>(Prisma.sql`SELECT COUNT(DISTINCT "memberId")::bigint AS count FROM "Attendance" WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end}`),
      prisma.memberRequest.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      prisma.memberRequest.count({ where: { createdAt: { gte: range.start, lt: range.end } } }),
    ]);
    const memberStatusCounts = new Map(memberStatuses.map((row) => [row.status, groupedCount(row._count)]));
    const requestStatusCounts = new Map(requestStatuses.map((row) => [row.status, groupedCount(row._count)]));
    return {
      totalRegistered,
      activeRegistered: memberStatusCounts.get(Status.ACTIVE) ?? 0,
      inactiveRegistered: memberStatusCounts.get(Status.INACTIVE) ?? 0,
      newRegistered,
      attendanceRecords,
      distinctAttendanceMembers: toNumber(distinctAttendanceRows[0]?.count ?? 0),
      pendingRequests: requestStatusCounts.get(MemberRequestStatus.PENDING) ?? 0,
      approvedRequests: requestStatusCounts.get(MemberRequestStatus.APPROVED) ?? 0,
      rejectedRequests: requestStatusCounts.get(MemberRequestStatus.REJECTED) ?? 0,
      newRequests,
    };
  }

  public async trends(range: DashboardRange): Promise<DashboardTrendPoint[]> {
    const prisma = getPrismaClient();
    const bucket = bucketExpression(range.granularity);
    const [members, attendance, requests] = await Promise.all([
      prisma.$queryRaw<BucketRow[]>(Prisma.sql`SELECT ${bucket} AS bucket, COUNT(*)::bigint AS count FROM "Member" WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<BucketRow[]>(Prisma.sql`SELECT ${bucket} AS bucket, COUNT(*)::bigint AS count FROM "Attendance" WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end} GROUP BY 1 ORDER BY 1`),
      prisma.$queryRaw<BucketRow[]>(Prisma.sql`SELECT ${bucket} AS bucket, COUNT(*)::bigint AS count FROM "MemberRequest" WHERE "createdAt" >= ${range.start} AND "createdAt" < ${range.end} GROUP BY 1 ORDER BY 1`),
    ]);
    const values = new Map<string, DashboardTrendPoint>();
    const ensure = (bucketKey: string) => values.get(bucketKey) ?? { bucket: bucketKey, registrations: 0, attendance: 0, membershipRequests: 0 };
    for (const row of members) { const point = ensure(row.bucket); point.registrations = toNumber(row.count); values.set(row.bucket, point); }
    for (const row of attendance) { const point = ensure(row.bucket); point.attendance = toNumber(row.count); values.set(row.bucket, point); }
    for (const row of requests) { const point = ensure(row.bucket); point.membershipRequests = toNumber(row.count); values.set(row.bucket, point); }
    return [...values.values()];
  }
}
