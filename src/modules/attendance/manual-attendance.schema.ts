import { z } from 'zod';

export const manualAttendanceBodySchema = z.object({ memberId: z.coerce.number().int().positive() }).strict();
export type ManualAttendanceInput = z.infer<typeof manualAttendanceBodySchema>;
export const manualAttendanceRequestSchema = z.object({ body: manualAttendanceBodySchema, params: z.object({}), query: z.object({}).strict() });
