import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const search = z.string().trim().min(1).max(200).optional();

export const adminUserListQuerySchema = z.object({
  search,
  status: z.nativeEnum(Status).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: adminUserListQuerySchema,
});

export const adminUserDetailRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});
