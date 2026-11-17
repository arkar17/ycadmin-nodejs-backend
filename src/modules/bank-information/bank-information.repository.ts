import type { PaymentTypes, Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type BankInformationRecord = {
  id: number;
  name: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  phone: string;
  paymentTypes: PaymentTypes;
  status: Status;
};

export type BankInformationPage = { records: BankInformationRecord[]; total: number };
export type BankInformationCreateData = Omit<BankInformationRecord, 'id'> & { actorId: number };
export type BankInformationUpdateData = Partial<Omit<BankInformationCreateData, 'actorId'>> & { actorId: number };

export interface BankInformationRepository {
  findPage(query: { name?: string; bankOrPhone?: string; paymentType?: PaymentTypes; status?: Status; limit: number; offset: number }): Promise<BankInformationPage>;
  findById(id: number): Promise<BankInformationRecord | null>;
  findActiveConflict(input: { accountNumber?: string; phone?: string; excludeId?: number }): Promise<{ accountNumber: boolean; phone: boolean }>;
  paymentCount(id: number): Promise<number>;
  create(input: BankInformationCreateData): Promise<BankInformationRecord>;
  update(id: number, input: BankInformationUpdateData): Promise<BankInformationRecord>;
  delete(id: number): Promise<void>;
}

const select = { id: true, name: true, bankAccountHolder: true, bankAccountNumber: true, phone: true, paymentTypes: true, status: true };

export class PrismaBankInformationRepository implements BankInformationRepository {
  public async findPage(query: { name?: string; bankOrPhone?: string; paymentType?: PaymentTypes; status?: Status; limit: number; offset: number }): Promise<BankInformationPage> {
    const prisma = getPrismaClient();
    const where: Prisma.BankInformationWhereInput = {
      ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}),
      ...(query.bankOrPhone ? { OR: [{ bankAccountHolder: { contains: query.bankOrPhone, mode: 'insensitive' } }, { bankAccountNumber: { contains: query.bankOrPhone, mode: 'insensitive' } }, { phone: { contains: query.bankOrPhone, mode: 'insensitive' } }] } : {}),
      ...(query.paymentType ? { paymentTypes: query.paymentType } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [records, total] = await prisma.$transaction([
      prisma.bankInformation.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }),
      prisma.bankInformation.count({ where }),
    ]);
    return { records, total };
  }

  public async findById(id: number): Promise<BankInformationRecord | null> {
    return getPrismaClient().bankInformation.findUnique({ where: { id }, select });
  }

  public async findActiveConflict(input: { accountNumber?: string; phone?: string; excludeId?: number }): Promise<{ accountNumber: boolean; phone: boolean }> {
    const prisma = getPrismaClient();
    const base: Prisma.BankInformationWhereInput = { status: 'ACTIVE', ...(input.excludeId ? { NOT: { id: input.excludeId } } : {}) };
    const [accountNumber, phone] = await Promise.all([
      input.accountNumber ? prisma.bankInformation.count({ where: { ...base, bankAccountNumber: input.accountNumber } }) : 0,
      input.phone ? prisma.bankInformation.count({ where: { ...base, phone: input.phone } }) : 0,
    ]);
    return { accountNumber: accountNumber > 0, phone: phone > 0 };
  }

  public async paymentCount(id: number): Promise<number> {
    return getPrismaClient().payment.count({ where: { bankInformationId: id } });
  }

  public async create(input: BankInformationCreateData): Promise<BankInformationRecord> {
    return getPrismaClient().bankInformation.create({ data: { name: input.name, bankAccountHolder: input.bankAccountHolder, bankAccountNumber: input.bankAccountNumber, phone: input.phone, paymentTypes: input.paymentTypes, status: input.status, createdById: input.actorId }, select });
  }

  public async update(id: number, input: BankInformationUpdateData): Promise<BankInformationRecord> {
    return getPrismaClient().bankInformation.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.bankAccountHolder !== undefined ? { bankAccountHolder: input.bankAccountHolder } : {}), ...(input.bankAccountNumber !== undefined ? { bankAccountNumber: input.bankAccountNumber } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(input.paymentTypes !== undefined ? { paymentTypes: input.paymentTypes } : {}), ...(input.status !== undefined ? { status: input.status } : {}), updatedById: input.actorId }, select });
  }

  public async delete(id: number): Promise<void> {
    await getPrismaClient().bankInformation.delete({ where: { id } });
  }
}
