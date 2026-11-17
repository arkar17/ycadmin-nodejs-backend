import { Status } from '@prisma/client';
import { AppError } from '../../shared/app-error.js';
import type { ManualAttendanceInput } from './manual-attendance.schema.js';
import { isAttendanceRollingConflict, type ManualAttendanceRecord, type ManualAttendanceRepository } from './manual-attendance.repository.js';

export type ManualAttendanceItem = { id: number; checkedInAt: string; recordedDate: string; source: 'MANUAL'; member: { id: number; name: string; clientCode: string } };
export class ManualAttendanceService {
  public constructor(private readonly repository: ManualAttendanceRepository) {}
  public async create(input: ManualAttendanceInput, actorId: number): Promise<ManualAttendanceItem> {
    const member = await this.repository.findMemberById(input.memberId);
    if (!member) throw new AppError({ statusCode: 404, code: 'MEMBER_NOT_FOUND', message: 'Member was not found.' });
    if (member.status !== Status.ACTIVE) throw new AppError({ statusCode: 409, code: 'MEMBER_INACTIVE', message: 'Member is inactive and cannot record attendance.' });
    try { return this.toItem(await this.repository.create({ memberId: member.id, actorId })); }
    catch (error) { if (isAttendanceRollingConflict(error)) throw new AppError({ statusCode: 409, code: 'ATTENDANCE_RECENTLY_RECORDED', message: 'Attendance was already recorded for this member within the last 60 minutes.' }); throw error; }
  }
  private readonly toItem = (record: ManualAttendanceRecord): ManualAttendanceItem => ({ id: record.id, checkedInAt: record.createdAt.toISOString(), recordedDate: record.date, source: 'MANUAL', member: { id: record.member.id, name: record.member.name, clientCode: record.member.code } });
}
