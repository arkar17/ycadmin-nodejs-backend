import { PaymentRequestType, PaymentStatus } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const amount = z.coerce.number().int().min(0);

export const paymentListQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  requestType: z.nativeEnum(PaymentRequestType).optional(),
  memberId: id.optional(),
  memberPlanId: id.optional(),
  memberTypeId: id.optional(),
  shopLevelId: id.optional(),
  minAmount: amount.optional(),
  maxAmount: amount.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict().superRefine((value, context) => {
  if (value.minAmount !== undefined && value.maxAmount !== undefined && value.minAmount > value.maxAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['minAmount'], message: 'minAmount must be less than or equal to maxAmount.' });
  }
});

export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
const params = z.object({ id });

export const paymentListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: paymentListQuerySchema,
});

export const paymentDetailRequestSchema = z.object({
  body: z.unknown(),
  params,
  query: z.object({}).strict(),
});

export const paymentAcceptRequestSchema = z.object({
  body: emptyBody,
  params,
  query: z.object({}).strict(),
});

export const paymentDeclineBodySchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
}).strict();

export const paymentDeclineRequestSchema = z.object({
  body: paymentDeclineBodySchema,
  params,
  query: z.object({}).strict(),
});

export type PaymentDeclineInput = z.infer<typeof paymentDeclineBodySchema>;
