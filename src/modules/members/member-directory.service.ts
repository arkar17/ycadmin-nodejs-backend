import type {
  MemberDirectoryPage,
  MemberDirectoryQuery,
  MemberDirectoryRepository,
} from './member-directory.repository.js';

export type MemberDirectoryItem = {
  id: number;
  clientCode: string;
  name: string;
  clientType: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  address: string | null;
  /** No current membership-plan relation exists in the verified schema. */
  memberPlan: null;
};

export class MemberDirectoryService {
  public constructor(private readonly repository: MemberDirectoryRepository) {}

  public async list(query: MemberDirectoryQuery): Promise<{ data: MemberDirectoryItem[]; total: number }> {
    const page = await this.repository.findPage(query);
    return { data: page.records.map(this.toItem), total: page.total };
  }

  private readonly toItem = (member: MemberDirectoryPage['records'][number]): MemberDirectoryItem => ({
    id: member.id,
    clientCode: member.code,
    name: member.name,
    clientType: member.clientType,
    phone: member.phone,
    email: member.email,
    gender: member.profile?.gender ?? null,
    address: member.profile?.address ?? null,
    memberPlan: null,
  });
}
