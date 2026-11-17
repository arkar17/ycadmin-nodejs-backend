import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const permissionId = z.coerce.number().int().positive();
const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
const roleName = z.string().trim().min(1).max(100).transform((value) => value.replace(/\s+/g, ' '));
const description = z.string().trim().max(2_000).nullable();
const permissionIds = z.array(permissionId).max(500).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate permission IDs are not allowed.' });
  }
});

export const adminRoleListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  status: z.nativeEnum(Status).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type AdminRoleListQuery = z.infer<typeof adminRoleListQuerySchema>;

export const adminRoleListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: adminRoleListQuerySchema,
});

export const adminRoleDetailRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminRoleCreateBodySchema = z.object({
  name: roleName,
  description: description.optional().default(null),
  status: z.nativeEnum(Status).optional().default(Status.ACTIVE),
  permissionIds: permissionIds.optional().default([]),
}).strict();

export type AdminRoleCreateInput = z.infer<typeof adminRoleCreateBodySchema>;

export const adminRoleCreateRequestSchema = z.object({
  body: adminRoleCreateBodySchema,
  params: z.object({}),
  query: z.object({}).strict(),
});

export const adminRoleUpdateBodySchema = z.object({
  name: roleName.optional(),
  description: description.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one role field is required.' });

export type AdminRoleUpdateInput = z.infer<typeof adminRoleUpdateBodySchema>;

export const adminRoleUpdateRequestSchema = z.object({
  body: adminRoleUpdateBodySchema,
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminRoleStatusRequestSchema = z.object({
  body: emptyBody,
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminRolePermissionRequestSchema = z.object({
  body: emptyBody,
  params: z.object({ id, permissionId }),
  query: z.object({}).strict(),
});

export const adminRoleReplacePermissionsRequestSchema = z.object({
  body: z.object({ permissionIds }).strict(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});
