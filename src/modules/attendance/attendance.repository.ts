import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prisma.js';

export type AttendanceRepositoryQuery = { memberName?: string; memberCode?: string; checkedInAt?: { start?: Date; end?: Date }; limit: number; offset: number };
export type AttendanceRecord = { id: number; date: string; createdAt: Date; member: { id: number; name: string; code: string; clientType: string; phone: string | null } };
export type AttendancePage = { records: AttendanceRecord[]; total: number };
export interface AttendanceRepository { findPage(query: AttendanceRepositoryQuery): Promise<AttendancePage>; }

const select = { id: true, date: true, createdAt: true, member: { select: { id: true, name: true, code: true, clientType: true, phone: true } } };
const whereFor = (query: AttendanceRepositoryQuery): Prisma.AttendanceWhereInput => ({
  ...(query.memberName || query.memberCode ? { member: { is: { ...(query.memberName ? { name: { contains: query.memberName, mode: 'insensitive' } } : {}), ...(query.memberCode ? { code: { contains: query.memberCode, mode: 'insensitive' } } : {}) } } } : {}),
  ...(query.checkedInAt ? { createdAt: { ...(query.checkedInAt.start ? { gte: query.checkedInAt.start } : {}), ...(query.checkedInAt.end ? { lt: query.checkedInAt.end } : {}) } } : {}),
});
export class PrismaAttendanceRepository implements AttendanceRepository {
  public async findPage(query: AttendanceRepositoryQuery): Promise<AttendancePage> { const prisma = getPrismaClient(); const where = whereFor(query); const [records, total] = await prisma.$transaction([prisma.attendance.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }), prisma.attendance.count({ where })]); return { records, total }; }
}
