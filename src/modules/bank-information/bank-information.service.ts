import { AppError } from '../../shared/app-error.js';
import type { BankInformationCreateInput, BankInformationListQuery, BankInformationUpdateInput } from './bank-information.schema.js';
import type { BankInformationRecord, BankInformationRepository } from './bank-information.repository.js';

type ListItem = { id: number; name: string; paymentType: string; accountHolder: string; accountNumberMasked: string; phone: string; status: string };
type DetailItem = { id: number; name: string; paymentType: string; accountHolder: string; accountNumber: string; phone: string; status: string };

const notFound = () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Bank information was not found.' });
const inUse = (paymentCount: number) => new AppError({ statusCode: 409, code: 'BANK_INFORMATION_IN_USE', message: 'Bank information is referenced by existing payments and cannot be changed or deleted.', details: { payments: paymentCount } });

export class BankInformationService {
  public constructor(private readonly repository: BankInformationRepository) {}

  public async list(query: BankInformationListQuery): Promise<{ data: ListItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toListItem), total: page.total };
  }

  public async detail(id: number): Promise<DetailItem> {
    const record = await this.repository.findById(id);
    if (!record) throw notFound();
    return this.toDetailItem(record);
  }

  public async create(input: BankInformationCreateInput, actorId: number): Promise<DetailItem> {
    await this.assertNoActiveConflict(input.accountNumber, input.phone);
    return this.toDetailItem(await this.repository.create({ name: input.name, bankAccountHolder: input.accountHolder, bankAccountNumber: input.accountNumber, phone: input.phone, paymentTypes: input.paymentType, status: input.status, actorId }));
  }

  public async update(id: number, input: BankInformationUpdateInput, actorId: number): Promise<DetailItem> {
    const existing = await this.repository.findById(id);
    if (!existing) throw notFound();
    await this.assertUnreferenced(id);
    const accountNumber = input.accountNumber !== undefined && input.accountNumber !== existing.bankAccountNumber ? input.accountNumber : undefined;
    const phone = input.phone !== undefined && input.phone !== existing.phone ? input.phone : undefined;
    await this.assertNoActiveConflict(accountNumber, phone, id);
    return this.toDetailItem(await this.repository.update(id, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.accountHolder !== undefined ? { bankAccountHolder: input.accountHolder } : {}), ...(input.accountNumber !== undefined ? { bankAccountNumber: input.accountNumber } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}), ...(input.paymentType !== undefined ? { paymentTypes: input.paymentType } : {}), ...(input.status !== undefined ? { status: input.status } : {}), actorId }));
  }

  public async remove(id: number): Promise<void> {
    if (!(await this.repository.findById(id))) throw notFound();
    await this.assertUnreferenced(id);
    await this.repository.delete(id);
  }

  private async assertNoActiveConflict(accountNumber?: string, phone?: string, excludeId?: number): Promise<void> {
    const conflict = await this.repository.findActiveConflict({ accountNumber, phone, excludeId });
    if (conflict.accountNumber || conflict.phone) {
      throw new AppError({ statusCode: 409, code: 'BANK_INFORMATION_CONFLICT', message: 'An active bank information record already uses this account number or phone.', details: { accountNumber: conflict.accountNumber, phone: conflict.phone } });
    }
  }

  private async assertUnreferenced(id: number): Promise<void> {
    const paymentCount = await this.repository.paymentCount(id);
    if (paymentCount > 0) throw inUse(paymentCount);
  }

  private readonly toListItem = (record: BankInformationRecord): ListItem => ({ id: record.id, name: record.name, paymentType: record.paymentTypes, accountHolder: record.bankAccountHolder, accountNumberMasked: this.mask(record.bankAccountNumber), phone: record.phone, status: record.status });
  private readonly toDetailItem = (record: BankInformationRecord): DetailItem => ({ id: record.id, name: record.name, paymentType: record.paymentTypes, accountHolder: record.bankAccountHolder, accountNumber: record.bankAccountNumber, phone: record.phone, status: record.status });
  private readonly mask = (value: string): string => value.length <= 4 ? '•'.repeat(value.length) : `${'•'.repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}
