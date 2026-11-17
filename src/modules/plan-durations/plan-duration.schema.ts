import { z } from 'zod';

const durationName = z.string().trim().min(1).max(100);
const durationValue = z.coerce.number().int().positive();
const idParams = z.object({ id: z.coerce.number().int().positive() });

export const planDurationListQuerySchema = z
  .object({
    name: durationName.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const planDurationCreateBodySchema = z
  .object({ name: durationName, value: durationValue })
  .strict();

export const planDurationUpdateBodySchema = z
  .object({ name: durationName.optional(), value: durationValue.optional() })
  .strict()
  .refine((value) => value.name !== undefined || value.value !== undefined, {
    message: 'At least one of name or value is required.',
  });

export type PlanDurationListQuery = z.infer<typeof planDurationListQuerySchema>;
export type PlanDurationCreateInput = z.infer<typeof planDurationCreateBodySchema>;
export type PlanDurationUpdateInput = z.infer<typeof planDurationUpdateBodySchema>;

export const planDurationListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: planDurationListQuerySchema });
export const planDurationCreateRequestSchema = z.object({ body: planDurationCreateBodySchema, params: z.object({}), query: z.object({}).strict() });
export const planDurationUpdateRequestSchema = z.object({ body: planDurationUpdateBodySchema, params: idParams, query: z.object({}).strict() });
export const planDurationDeleteRequestSchema = z.object({ body: z.unknown(), params: idParams, query: z.object({}).strict() });
