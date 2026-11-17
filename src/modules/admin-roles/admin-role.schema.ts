import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();

export const adminRoleListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.nativeEnum(Status).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type AdminRoleListQuery = z.infer<typeof adminRoleListQuerySchema>;

export const adminRoleListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: adminRoleListQuerySchema,
});

export const adminRoleDetailRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});
