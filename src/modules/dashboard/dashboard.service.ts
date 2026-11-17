import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { DashboardRange, DashboardRepository, DashboardTrendPoint } from './dashboard.repository.js';
import type { DashboardOverviewQuery } from './dashboard.schema.js';

const dayMs = 86_400_000;
const yangonOffsetMs = 6.5 * 60 * 60 * 1000;

export type DashboardOverview = {
  period: { kind: 'month' | 'custom'; timezone: 'Asia/Yangon'; from: string; to: string; startsAt: string; endsAt: string };
  members: { totalRegistered: number; activeRegistered: number; inactiveRegistered: number; newRegistered: number };
  attendance: { totalRecords: number; distinctMembers: number };
  membershipRequests: { currentStatus: { pending: number; approved: number; rejected: number }; newSubmitted: number };
  trends: { granularity: 'day' | 'month'; points: DashboardTrendPoint[] };
};

type ResolvedPeriod = { kind: 'month' | 'custom'; from: string; to: string; range: DashboardRange };

const nextDate = (value: string): string => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)) + 1)).toISOString().slice(0, 10);
const nextMonth = (value: string): string => {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
};
const currentYangonMonth = (): string => new Date(Date.now() + yangonOffsetMs).toISOString().slice(0, 7);

const monthPeriod = (month: string, granularity?: 'day' | 'month'): ResolvedPeriod => {
  const from = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const start = yangonDateToUtcRange(from).start;
  const end = yangonDateToUtcRange(nextDate(to)).start;
  return { kind: 'month', from, to, range: { start, end, granularity: granularity ?? 'day' } };
};

const customPeriod = (from: string, to: string, granularity?: 'day' | 'month'): ResolvedPeriod => {
  const start = yangonDateToUtcRange(from).start;
  const end = yangonDateToUtcRange(to).end;
  const days = (end.getTime() - start.getTime()) / dayMs;
  return { kind: 'custom', from, to, range: { start, end, granularity: granularity ?? (days <= 62 ? 'day' : 'month') } };
};

const zeroFilledBuckets = (period: ResolvedPeriod): string[] => {
  const values: string[] = [];
  if (period.range.granularity === 'day') {
    for (let cursor = period.from; cursor <= period.to; cursor = nextDate(cursor)) values.push(cursor);
    return values;
  }
  let cursor = period.from.slice(0, 7);
  const last = period.to.slice(0, 7);
  while (cursor <= last) { values.push(cursor); cursor = nextMonth(cursor); }
  return values;
};

export class DashboardService {
  public constructor(private readonly repository: DashboardRepository) {}

  public async overview(query: DashboardOverviewQuery): Promise<DashboardOverview> {
    const period = query.month ? monthPeriod(query.month, query.granularity) : query.from && query.to ? customPeriod(query.from, query.to, query.granularity) : monthPeriod(currentYangonMonth(), query.granularity);
    const [aggregate, trendValues] = await Promise.all([this.repository.aggregate(period.range), this.repository.trends(period.range)]);
    const trendMap = new Map(trendValues.map((value) => [value.bucket, value]));
    const points = zeroFilledBuckets(period).map((bucket) => trendMap.get(bucket) ?? { bucket, registrations: 0, attendance: 0, membershipRequests: 0 });
    return {
      period: { kind: period.kind, timezone: 'Asia/Yangon', from: period.from, to: period.to, startsAt: period.range.start.toISOString(), endsAt: period.range.end.toISOString() },
      members: { totalRegistered: aggregate.totalRegistered, activeRegistered: aggregate.activeRegistered, inactiveRegistered: aggregate.inactiveRegistered, newRegistered: aggregate.newRegistered },
      attendance: { totalRecords: aggregate.attendanceRecords, distinctMembers: aggregate.distinctAttendanceMembers },
      membershipRequests: { currentStatus: { pending: aggregate.pendingRequests, approved: aggregate.approvedRequests, rejected: aggregate.rejectedRequests }, newSubmitted: aggregate.newRequests },
      trends: { granularity: period.range.granularity, points },
    };
  }
}
