import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const search = z.string().trim().min(1).max(200).optional();

export const shopListQuerySchema = z.object({
  name: search,
  memberId: id.optional(),
  memberName: search,
  memberCode: search,
  shopLevelId: id.optional(),
  status: z.nativeEnum(Status).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type ShopListQuery = z.output<typeof shopListQuerySchema>;
export const shopListRequestSchema = z.object({ body: z.unknown(), params: z.object({}).strict(), query: shopListQuerySchema });
export const shopDetailRequestSchema = z.object({ body: z.unknown(), params: z.object({ id }).strict(), query: z.object({}).strict() });
