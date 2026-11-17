import { Prisma } from '@prisma/client';

import { AppError } from '../../shared/app-error.js';
import type { PlanDurationCreateInput, PlanDurationListQuery, PlanDurationUpdateInput } from './plan-duration.schema.js';
import type { PlanDurationRecord, PlanDurationRepository } from './plan-duration.repository.js';

export type PlanDurationItem = { id: number; name: string; value: number };

const notFound = (): AppError => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Plan duration was not found.' });
const valueConflict = (): AppError => new AppError({ statusCode: 409, code: 'DURATION_VALUE_CONFLICT', message: 'A plan duration with this value already exists.' });

export class PlanDurationService {
  public constructor(private readonly repository: PlanDurationRepository) {}

  public async list(query: PlanDurationListQuery): Promise<{ data: PlanDurationItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toItem), total: page.total };
  }

  public async create(input: PlanDurationCreateInput): Promise<PlanDurationItem> {
    if (await this.repository.findByValue(input.value)) throw valueConflict();
    try {
      return this.toItem(await this.repository.create(input));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw valueConflict();
      throw error;
    }
  }

  public async update(id: number, input: PlanDurationUpdateInput): Promise<PlanDurationItem> {
    const existing = await this.repository.findById(id);
    if (!existing) throw notFound();
    if (input.value !== undefined && input.value !== existing.value) {
      const sameValue = await this.repository.findByValue(input.value);
      if (sameValue && sameValue.id !== id) throw valueConflict();
    }
    await this.assertUnreferenced(id);
    try {
      return this.toItem(await this.repository.update(id, input));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw valueConflict();
      throw error;
    }
  }

  public async remove(id: number): Promise<void> {
    if (!(await this.repository.findById(id))) throw notFound();
    await this.assertUnreferenced(id);
    await this.repository.delete(id);
  }

  private async assertUnreferenced(id: number): Promise<void> {
    const references = await this.repository.referenceCount(id);
    if (references.memberPlans > 0 || references.shopLevels > 0) {
      throw new AppError({
        statusCode: 409,
        code: 'DURATION_IN_USE',
        message: 'Plan duration is referenced by an existing plan or shop level and cannot be changed or deleted.',
        details: references,
      });
    }
  }

  private readonly toItem = (duration: PlanDurationRecord): PlanDurationItem => ({ id: duration.id, name: duration.name, value: duration.value });
}
