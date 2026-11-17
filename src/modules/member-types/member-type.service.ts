import type { MemberTypeListQuery } from './member-type.schema.js';
import type { MemberTypeRepository } from './member-type.repository.js';

export type MemberTypeItem = { id: number; name: string; status: string };

export class MemberTypeService {
  public constructor(private readonly repository: MemberTypeRepository) {}

  public async list(query: MemberTypeListQuery): Promise<{ data: MemberTypeItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(({ id, name, status }) => ({ id, name, status })), total: page.total };
  }
}
