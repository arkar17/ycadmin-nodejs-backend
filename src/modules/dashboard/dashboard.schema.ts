import { z } from 'zod';

import { isIsoCalendarDate, yangonDateToUtcRange } from '../../shared/yangon-calendar.js';

const validMonth = (value: string): boolean => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
};

const month = z.string().refine(validMonth, 'month must be a valid YYYY-MM value between 2000-01 and 2100-12.');
const date = z.string().refine(isIsoCalendarDate, 'date must be a valid YYYY-MM-DD calendar date.');

export const dashboardOverviewQuerySchema = z.object({
  month: month.optional(),
  from: date.optional(),
  to: date.optional(),
  granularity: z.enum(['day', 'month']).optional(),
}).strict().superRefine((value, context) => {
  if (value.month && (value.from || value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['month'], message: 'month cannot be combined with from or to.' });
  }
  if ((value.from && !value.to) || (!value.from && value.to)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'from and to must be supplied together.' });
    return;
  }
  if (value.from && value.to) {
    const start = yangonDateToUtcRange(value.from).start;
    const end = yangonDateToUtcRange(value.to).end;
    if (start >= end) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must not be before from.' });
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    if (days > 366) context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date ranges may not exceed 366 calendar days.' });
    if (value.granularity === 'day' && days > 93) context.addIssue({ code: z.ZodIssueCode.custom, path: ['granularity'], message: 'Daily trends may not exceed 93 calendar days.' });
  }
});

export type DashboardOverviewQuery = z.infer<typeof dashboardOverviewQuerySchema>;

export const dashboardOverviewRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: dashboardOverviewQuerySchema });
