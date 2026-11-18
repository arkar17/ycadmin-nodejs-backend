import { MemberRequestStatus } from '@prisma/client';
import { z } from 'zod';
import { isIsoCalendarDate } from '../../shared/yangon-calendar.js';
const id = z.coerce.number().int().positive();
const search = z.string().trim().min(1).max(200).optional();
export const shopUpgradeRequestListQuerySchema = z.object({
  memberName: search, memberCode: search, shopLevelId: id.optional(), status: z.nativeEnum(MemberRequestStatus).optional(),
  date: z.string().refine(isIsoCalendarDate, 'date must be a valid YYYY-MM-DD calendar date.').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0),
}).strict();
export type ShopUpgradeRequestListQuery = z.output<typeof shopUpgradeRequestListQuerySchema>;
const params = z.object({ id }).strict();
const proofParams = z.object({ requestId: id, paymentId: id }).strict();
const decision = z.object({ paymentId: z.number().int().positive() }).strict();
const rejection = decision.extend({ reason: z.string().trim().min(1).max(2_000) }).strict();
export const shopUpgradeRequestListRequestSchema = z.object({ body: z.unknown(), params: z.object({}).strict(), query: shopUpgradeRequestListQuerySchema });
export const shopUpgradeRequestDetailRequestSchema = z.object({ body: z.unknown(), params, query: z.object({}).strict() });
export const shopUpgradeRequestApproveRequestSchema = z.object({ body: decision, params, query: z.object({}).strict() });
export const shopUpgradeRequestRejectRequestSchema = z.object({ body: rejection, params, query: z.object({}).strict() });
export const shopUpgradeRequestProofRequestSchema = z.object({ body: z.unknown(), params: proofParams, query: z.object({}).strict() });
