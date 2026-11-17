import { z } from 'zod';
import { isIsoCalendarDate } from '../../shared/yangon-calendar.js';

const search = z.string().trim().min(1).max(200).optional();
const date = z.string().refine(isIsoCalendarDate, 'Date must be a valid YYYY-MM-DD calendar date.').optional();

export const attendanceListQuerySchema = z.object({
  memberName: search, name: search,
  memberCode: search, member_code: search,
  dateFrom: date, date_from: date,
  dateTo: date, date_to: date,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((value, context) => {
  const aliases: Array<[keyof typeof value, keyof typeof value, string]> = [['memberName', 'name', 'memberName and name'], ['memberCode', 'member_code', 'memberCode and member_code'], ['dateFrom', 'date_from', 'dateFrom and date_from'], ['dateTo', 'date_to', 'dateTo and date_to']];
  for (const [canonical, legacy, label] of aliases) if (value[canonical] && value[legacy] && value[canonical] !== value[legacy]) context.addIssue({ code: 'custom', path: [canonical], message: `${label} must match when both are provided.` });
  const from = value.dateFrom ?? value.date_from; const to = value.dateTo ?? value.date_to;
  if (from && to && from > to) context.addIssue({ code: 'custom', path: ['dateTo'], message: 'dateTo must be on or after dateFrom.' });
}).transform(({ name, member_code, date_from, date_to, ...value }) => ({ ...value, memberName: value.memberName ?? name, memberCode: value.memberCode ?? member_code, dateFrom: value.dateFrom ?? date_from, dateTo: value.dateTo ?? date_to }));

export type AttendanceListQuery = z.output<typeof attendanceListQuerySchema>;
export const attendanceListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: attendanceListQuerySchema });
