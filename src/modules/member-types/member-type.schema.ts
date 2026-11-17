import { Status } from '@prisma/client';
import { z } from 'zod';

const optionalName = z.string().trim().min(1).max(100).optional();

export const memberTypeListQuerySchema = z
  .object({
    name: optionalName,
    status: z.nativeEnum(Status).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type MemberTypeListQuery = z.infer<typeof memberTypeListQuerySchema>;

export const memberTypeListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: memberTypeListQuerySchema });
