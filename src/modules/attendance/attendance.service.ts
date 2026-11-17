import { yangonDateToUtcRange } from '../../shared/yangon-calendar.js';
import type { AttendanceListQuery } from './attendance.schema.js';
import type { AttendanceRecord, AttendanceRepository } from './attendance.repository.js';

export type AttendanceItem = { id: number; checkedInAt: string; recordedDate: string; member: { id: number; name: string; clientCode: string; clientType: string; phone: string | null } };
export class AttendanceService {
  public constructor(private readonly repository: AttendanceRepository) {}
  public async list(query: AttendanceListQuery): Promise<{ data: AttendanceItem[]; total: number }> {
    const start = query.dateFrom ? yangonDateToUtcRange(query.dateFrom).start : undefined;
    const end = query.dateTo ? yangonDateToUtcRange(query.dateTo).end : undefined;
    const page = await this.repository.findPage({ memberName: query.memberName, memberCode: query.memberCode, ...(start || end ? { checkedInAt: { start, end } } : {}), limit: query.limit, offset: query.offset });
    return { data: page.records.map(this.toItem), total: page.total };
  }
  private readonly toItem = (record: AttendanceRecord): AttendanceItem => ({ id: record.id, checkedInAt: record.createdAt.toISOString(), recordedDate: record.date, member: { id: record.member.id, name: record.member.name, clientCode: record.member.code, clientType: record.member.clientType, phone: record.member.phone } });
}
