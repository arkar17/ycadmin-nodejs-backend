import { Gender } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
const text = (maximum: number) => z.string().trim().max(maximum);

export const memberDetailRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const memberUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().min(9).max(15).optional(),
  address: text(500).optional(),
  bio: text(10_000).optional(),
  gender: z.nativeEnum(Gender).optional(),
  age: z.number().int().min(0).max(150).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one supported member field is required.',
});

export type MemberUpdateInput = z.infer<typeof memberUpdateBodySchema>;

export const memberUpdateRequestSchema = z.object({
  body: memberUpdateBodySchema,
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const memberStatusRequestSchema = z.object({
  body: emptyBody,
  params: z.object({ id }),
  query: z.object({}).strict(),
});
