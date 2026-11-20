import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const integer = z.number().int().min(0).max(2_147_483_647);
const name = z.string().trim().min(1).max(100);
const description = z.string().trim().min(1).max(2_000).nullable();
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
export const shopPlanLevelCreateBodySchema = z.object({
  name,
  price: integer,
  durationId: id,
  description: description.optional(),
  postLimit: integer,
  status: z.nativeEnum(Status).default(Status.ACTIVE),
}).strict();
export const shopPlanLevelUpdateBodySchema = z.object({
  name: name.optional(),
  price: integer.optional(),
  durationId: id.optional(),
  description: description.optional(),
  postLimit: integer.optional(),
  status: z.nativeEnum(Status).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one mutable field is required.');

export type ShopPlanLevelListQuery = z.infer<typeof shopPlanLevelListQuerySchema>;
export type ShopPlanLevelDetailParams = z.infer<typeof shopPlanLevelDetailParamsSchema>;
export type ShopPlanLevelCreateInput = z.infer<typeof shopPlanLevelCreateBodySchema>;
export type ShopPlanLevelUpdateInput = z.infer<typeof shopPlanLevelUpdateBodySchema>;

export const shopPlanLevelListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: shopPlanLevelListQuerySchema });
export const shopPlanLevelDetailRequestSchema = z.object({ body: z.unknown(), params: shopPlanLevelDetailParamsSchema, query: z.object({}).strict() });
export const shopPlanLevelCreateRequestSchema = z.object({ body: shopPlanLevelCreateBodySchema, params: z.object({}), query: z.object({}).strict() });
export const shopPlanLevelUpdateRequestSchema = z.object({ body: shopPlanLevelUpdateBodySchema, params: shopPlanLevelDetailParamsSchema, query: z.object({}).strict() });
export const shopPlanLevelDeleteRequestSchema = z.object({ body: z.unknown(), params: shopPlanLevelDetailParamsSchema, query: z.object({}).strict() });
