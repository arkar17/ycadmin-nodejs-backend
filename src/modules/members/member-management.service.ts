import { AppError } from '../../shared/app-error.js';
import type { MemberUpdateInput } from './member-management.schema.js';
import {
  activeMemberStatus,
  inactiveMemberStatus,
  type MemberManagementRecord,
  type MemberManagementRepository,
  type MemberMutationResult,
} from './member-management.repository.js';

export class MemberManagementService {
  public constructor(private readonly repository: MemberManagementRepository) {}

  public async detail(id: number): Promise<MemberManagementRecord> {
    const member = await this.repository.findById(id);
    if (!member) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Member was not found.' });
    return member;
  }

  public update(id: number, actorUserId: number, input: MemberUpdateInput): Promise<MemberMutationResult> {
    return this.repository.update(id, actorUserId, input);
  }

  public activate(id: number, actorUserId: number): Promise<MemberMutationResult> {
    return this.repository.setStatus(id, actorUserId, activeMemberStatus);
  }

  public deactivate(id: number, actorUserId: number): Promise<MemberMutationResult> {
    return this.repository.setStatus(id, actorUserId, inactiveMemberStatus);
  }
}
