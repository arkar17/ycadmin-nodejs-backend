import { PaymentTypes, Status } from '@prisma/client';
import { z } from 'zod';

const id = z.coerce.number().int().positive();
const requiredText = z.string().trim().min(1).max(255);
const phone = z.string().trim().min(9).max(32);
const accountNumber = z.string().trim().min(1).max(255);

export const bankInformationListQuerySchema = z
  .object({
    name: requiredText.optional(),
    // Canonical REST filter plus the existing frontend's legacy filter spelling.
    bankOrPhone: requiredText.optional(),
    bank_or_phone: requiredText.optional(),
    paymentType: z.nativeEnum(PaymentTypes).optional(),
    status: z.nativeEnum(Status).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.bankOrPhone !== undefined && value.bank_or_phone !== undefined && value.bankOrPhone !== value.bank_or_phone) {
      context.addIssue({ code: 'custom', path: ['bank_or_phone'], message: 'bankOrPhone and bank_or_phone must match when both are provided.' });
    }
  })
  .transform(({ bank_or_phone: legacyBankOrPhone, ...value }) => ({
    ...value,
    bankOrPhone: value.bankOrPhone ?? legacyBankOrPhone,
  }));

export const bankInformationCreateBodySchema = z
  .object({
    name: requiredText,
    paymentType: z.nativeEnum(PaymentTypes).default(PaymentTypes.BANK_ACCOUNT),
    accountNumber,
    accountHolder: requiredText,
    phone,
    status: z.nativeEnum(Status).default(Status.ACTIVE),
  })
  .strict();

export const bankInformationUpdateBodySchema = z
  .object({
    name: requiredText.optional(),
    paymentType: z.nativeEnum(PaymentTypes).optional(),
    accountNumber: accountNumber.optional(),
    accountHolder: requiredText.optional(),
    phone: phone.optional(),
    status: z.nativeEnum(Status).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one mutable field is required.');

export type BankInformationListQuery = z.output<typeof bankInformationListQuerySchema>;
export type BankInformationCreateInput = z.infer<typeof bankInformationCreateBodySchema>;
export type BankInformationUpdateInput = z.infer<typeof bankInformationUpdateBodySchema>;

const idParams = z.object({ id });
export const bankInformationListRequestSchema = z.object({ body: z.unknown(), params: z.object({}), query: bankInformationListQuerySchema });
export const bankInformationDetailRequestSchema = z.object({ body: z.unknown(), params: idParams, query: z.object({}).strict() });
export const bankInformationCreateRequestSchema = z.object({ body: bankInformationCreateBodySchema, params: z.object({}), query: z.object({}).strict() });
export const bankInformationUpdateRequestSchema = z.object({ body: bankInformationUpdateBodySchema, params: idParams, query: z.object({}).strict() });
export const bankInformationDeleteRequestSchema = z.object({ body: z.unknown(), params: idParams, query: z.object({}).strict() });
