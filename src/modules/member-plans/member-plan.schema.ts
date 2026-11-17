import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const name = z.string().trim().min(1).max(150);
const ids = z.array(id).max(100).refine((values) => new Set(values).size === values.length, 'IDs must be unique.');

export const memberPlanListQuerySchema = z.object({ name: name.optional(), memberTypeId: id.optional(), status: z.nativeEnum(Status).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }).strict();
export const memberPlanCreateBodySchema = z.object({ name, memberTypeId: id, durationId: id, price: z.coerce.number().int().min(0), prosIds: ids.default([]), consIds: ids.default([]), isVideoGroup: z.coerce.boolean().default(false), status: z.nativeEnum(Status).default(Status.ACTIVE) }).strict();
export const memberPlanUpdateBodySchema = z.object({ name: name.optional(), memberTypeId: id.optional(), durationId: id.optional(), price: z.coerce.number().int().min(0).optional(), prosIds: ids.optional(), consIds: ids.optional(), isVideoGroup: z.coerce.boolean().optional(), status: z.nativeEnum(Status).optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one mutable field is required.');

export type MemberPlanListQuery = z.infer<typeof memberPlanListQuerySchema>;
export type MemberPlanCreateInput = z.infer<typeof memberPlanCreateBodySchema>;
export type MemberPlanUpdateInput = z.infer<typeof memberPlanUpdateBodySchema>;
export const memberPlanListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: memberPlanListQuerySchema });
export const memberPlanDetailRequestSchema = z.object({ body: z.unknown(), params: z.object({ id }), query: z.object({}).strict() });
export const memberPlanCreateRequestSchema = z.object({ body: memberPlanCreateBodySchema, params: z.object({}), query: z.object({}).strict() });
export const memberPlanUpdateRequestSchema = z.object({ body: memberPlanUpdateBodySchema, params: z.object({ id }), query: z.object({}).strict() });
export const memberPlanDeleteRequestSchema = z.object({ body: z.unknown(), params: z.object({ id }), query: z.object({}).strict() });
