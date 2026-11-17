import { Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const search = z.string().trim().min(1).max(200).optional();
const roleId = z.coerce.number().int().positive();
const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
const normalizedEmail = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const normalizedUsername = z.string().trim().min(1).max(100)
  .regex(/^\S+$/, 'Username must not contain spaces.')
  .transform((value) => value.toLowerCase());
const roleIds = z.array(roleId).min(1, 'At least one role is required.').max(100)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate role IDs are not allowed.' });
    }
  });
const replacementRoleIds = z.array(roleId).max(100).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate role IDs are not allowed.' });
  }
});
const password = z.string().regex(
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/,
  'Password must include uppercase, lowercase, number, and special character.',
);

export const adminUserListQuerySchema = z.object({
  search,
  status: z.nativeEnum(Status).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserListRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: adminUserListQuerySchema,
});

export const adminUserDetailRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminUserCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: normalizedEmail,
  username: normalizedUsername,
  password,
  passwordConfirm: z.string().max(128),
  status: z.nativeEnum(Status).optional().default(Status.ACTIVE),
  roleIds,
}).strict().refine((value) => value.password === value.passwordConfirm, {
  path: ['passwordConfirm'],
  message: 'Passwords do not match.',
});

export type AdminUserCreateInput = z.infer<typeof adminUserCreateBodySchema>;

export const adminUserCreateRequestSchema = z.object({
  body: adminUserCreateBodySchema,
  params: z.object({}),
  query: z.object({}).strict(),
});

export const adminUserUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: normalizedEmail.optional(),
  username: normalizedUsername.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'At least one profile field is required.' });

export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateBodySchema>;

export const adminUserUpdateRequestSchema = z.object({
  body: adminUserUpdateBodySchema,
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminUserStatusRequestSchema = z.object({
  body: emptyBody,
  params: z.object({ id }),
  query: z.object({}).strict(),
});

export const adminUserRoleRequestSchema = z.object({
  body: emptyBody,
  params: z.object({ id, roleId }),
  query: z.object({}).strict(),
});

export const adminUserReplaceRolesRequestSchema = z.object({
  body: z.object({ roleIds: replacementRoleIds }).strict(),
  params: z.object({ id }),
  query: z.object({}).strict(),
});
