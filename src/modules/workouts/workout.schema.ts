import { Status } from '@prisma/client';
import { z } from 'zod';

const search = z.string().trim().min(1).max(200).optional();
const identifier = z.coerce.number().int().positive().optional();

export const workoutListQuerySchema = z.object({ name: search, workoutName: search, workout_name: search, categoryId: identifier, memberPlanId: identifier, member_plan_id: identifier, status: z.nativeEnum(Status).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }).strict().superRefine((value, context) => { if (value.name && value.workoutName && value.name !== value.workoutName) context.addIssue({ code: 'custom', path: ['name'], message: 'name and workoutName must match when both are provided.' }); if (value.workoutName && value.workout_name && value.workoutName !== value.workout_name) context.addIssue({ code: 'custom', path: ['workoutName'], message: 'workoutName and workout_name must match when both are provided.' }); if (value.memberPlanId && value.member_plan_id && value.memberPlanId !== value.member_plan_id) context.addIssue({ code: 'custom', path: ['memberPlanId'], message: 'memberPlanId and member_plan_id must match when both are provided.' }); });
export const workoutDetailParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const positiveCount = z.coerce.number().int().min(1).max(10000);
export const workoutUpdateBodySchema = z.object({ name: z.string().trim().min(1).max(200).optional(), gender: z.enum(['MALE', 'FEMALE', 'BOTH']).optional(), workoutDay: z.enum(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']).optional(), sets: positiveCount.optional(), reps: positiveCount.optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict().refine((value) => Object.keys(value).length > 0, 'At least one supported update field is required.');
export type WorkoutListQuery = z.infer<typeof workoutListQuerySchema>;
export const workoutListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: workoutListQuerySchema });
export const workoutDetailRequestSchema = z.object({ body: z.unknown(), params: workoutDetailParamsSchema, query: z.object({}).strict() });
export const workoutUpdateRequestSchema = z.object({ body: workoutUpdateBodySchema, params: workoutDetailParamsSchema, query: z.object({}).strict() });
export type WorkoutUpdateInput = z.infer<typeof workoutUpdateBodySchema>;
