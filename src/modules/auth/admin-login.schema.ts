import { z } from 'zod';

const identifier = z.string().trim().min(1).max(320);

export const adminLoginBodySchema = z.object({
  emailOrUsername: identifier,
  password: z.string().min(1).max(1024),
}).strict();

export type AdminLoginInput = z.infer<typeof adminLoginBodySchema>;

export const adminLoginRequestSchema = z.object({
  body: adminLoginBodySchema,
  params: z.object({}),
  query: z.object({}).strict(),
});
