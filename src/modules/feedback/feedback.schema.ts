import { z } from 'zod';

import { isIsoCalendarDate } from '../../shared/yangon-calendar.js';

const optionalSearch = z.string().trim().min(1).max(200).optional();
const calendarDate = z
  .string()
  .refine(isIsoCalendarDate, 'date must be a valid YYYY-MM-DD calendar date.')
  .optional();

export const feedbackListQuerySchema = z
  .object({
    // `name` and `client_code` retain compatibility with the current frontend;
    // `clientCode` is the canonical REST spelling from the API specification.
    name: optionalSearch,
    clientCode: optionalSearch,
    client_code: optionalSearch,
    date: calendarDate,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.clientCode && value.client_code && value.clientCode !== value.client_code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clientCode'],
        message: 'clientCode and client_code must match when both are provided.',
      });
    }
  });

export const feedbackDetailParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type FeedbackListQueryInput = z.infer<typeof feedbackListQuerySchema>;
export type FeedbackDetailParamsInput = z.infer<typeof feedbackDetailParamsSchema>;

export const feedbackListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: feedbackListQuerySchema,
});

export const feedbackDetailRequestSchema = z.object({
  body: z.unknown(),
  params: feedbackDetailParamsSchema,
  query: z.object({}).strict(),
});
