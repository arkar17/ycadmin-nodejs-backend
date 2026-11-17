import { z } from 'zod';

const optionalSearch = z.string().trim().min(1).max(200).optional();

export const memberDirectoryQuerySchema = z
  .object({
    name: optionalSearch,
    contact: optionalSearch,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    // Accept the current REST and legacy frontend names solely to return a clear error.
    memberPlanId: z.coerce.number().int().positive().optional(),
    member_plan_id: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.memberPlanId !== undefined || value.member_plan_id !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.memberPlanId !== undefined ? ['memberPlanId'] : ['member_plan_id'],
        message: 'Member-plan filtering is unavailable because the shared schema has no current member-plan relationship.',
      });
    }
  });

export type MemberDirectoryQueryInput = z.infer<typeof memberDirectoryQuerySchema>;

export const memberDirectoryRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: memberDirectoryQuerySchema,
});
