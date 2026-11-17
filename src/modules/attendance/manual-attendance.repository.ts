import { AttendanceSource, Prisma, Status } from '@prisma/client';
import { getPrismaClient } from '../../database/prisma.js';

export type ManualAttendanceMember = { id: number; name: string; code: string; status: Status };
export type ManualAttendanceRecord = { id: number; createdAt: Date; date: string; source: AttendanceSource; qrToken: string | null; createdById: number | null; member: { id: number; name: string; code: string } };
export interface ManualAttendanceRepository { findMemberById(id: number): Promise<ManualAttendanceMember | null>; create(input: { memberId: number; actorId: number }): Promise<ManualAttendanceRecord>; }
const select = { id: true, createdAt: true, date: true, source: true, qrToken: true, createdById: true, member: { select: { id: true, name: true, code: true } } };
export class PrismaManualAttendanceRepository implements ManualAttendanceRepository {
  public async findMemberById(id: number): Promise<ManualAttendanceMember | null> { return getPrismaClient().member.findUnique({ where: { id }, select: { id: true, name: true, code: true, status: true } }); }
  public async create(input: { memberId: number; actorId: number }): Promise<ManualAttendanceRecord> { return getPrismaClient().attendance.create({ data: { memberId: input.memberId, source: AttendanceSource.MANUAL, createdById: input.actorId, qrToken: null }, select }); }
}

export const isAttendanceRollingConflict = (error: unknown): boolean => {
  const value = error instanceof Error ? error.message : '';
  const cause = error && typeof error === 'object' && 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  const sqlState = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
  // Prisma's adapter currently retains SQLSTATE/message but drops PostgreSQL's constraint field.
  return sqlState === 'P0001' && value.includes('ATTENDANCE_RECENTLY_RECORDED');
};
