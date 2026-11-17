import { MemberRequestStatus } from '@prisma/client';
import { z } from 'zod';

import { isIsoCalendarDate } from '../../shared/yangon-calendar.js';

const id = z.coerce.number().int().positive();
const search = z.string().trim().min(1).max(200).optional();
const date = z.string().refine(isIsoCalendarDate, 'date must be a valid YYYY-MM-DD calendar date.').optional();

export const membershipRequestListQuerySchema = z
  .object({
    memberName: search,
    member_name: search,
    memberPlanId: id.optional(),
    member_plan_id: id.optional(),
    status: z.nativeEnum(MemberRequestStatus).optional(),
    date,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.memberName && value.member_name && value.memberName !== value.member_name) context.addIssue({ code: 'custom', path: ['memberName'], message: 'memberName and member_name must match when both are provided.' });
    if (value.memberPlanId && value.member_plan_id && value.memberPlanId !== value.member_plan_id) context.addIssue({ code: 'custom', path: ['memberPlanId'], message: 'memberPlanId and member_plan_id must match when both are provided.' });
  })
  .transform(({ member_name, member_plan_id, ...value }) => ({ ...value, memberName: value.memberName ?? member_name, memberPlanId: value.memberPlanId ?? member_plan_id }));

export type MembershipRequestListQuery = z.output<typeof membershipRequestListQuerySchema>;
const params = z.object({ id });
export const membershipRequestListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: membershipRequestListQuerySchema });
export const membershipRequestDetailRequestSchema = z.object({ body: z.unknown(), params, query: z.object({}).strict() });
