import { z } from 'zod';

/** POST creates a server-generated credential and intentionally accepts no input. */
export const attendanceQrCreateRequestSchema = z.object({
  // An omitted body and `{}` are both valid: creation is fully server-side.
  // Any supplied property is rejected rather than silently ignored.
  body: z.object({}).strict().default({}),
  params: z.object({}),
  query: z.object({}),
});
