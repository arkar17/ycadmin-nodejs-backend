import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const optionalName = z.string().trim().min(1).max(100).optional();

export const shopPlanLevelListQuerySchema = z.object({
  name: optionalName,
  status: z.nativeEnum(Status).optional(),
  durationId: id.optional(),
  postLimit: z.coerce.number().int().min(0).max(100_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export const shopPlanLevelDetailParamsSchema = z.object({ id });

export type ShopPlanLevelListQuery = z.infer<typeof shopPlanLevelListQuerySchema>;
export type ShopPlanLevelDetailParams = z.infer<typeof shopPlanLevelDetailParamsSchema>;

export const shopPlanLevelListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: shopPlanLevelListQuerySchema });
export const shopPlanLevelDetailRequestSchema = z.object({ body: z.unknown(), params: shopPlanLevelDetailParamsSchema, query: z.object({}).strict() });
