import type { Prisma, Status } from '@prisma/client';
import { getPrismaClient } from '../../database/prisma.js';

export type MemberPlanRecord = { id: number; name: string; price: number; duration: number; isVideoGroup: boolean; status: Status; memberType: { id: number; name: string; status: Status }; planDuration: { id: number; name: string; value: number } | null; pros: { id: number; name: string }[]; cons: { id: number; name: string }[] };
export type MemberPlanPage = { records: MemberPlanRecord[]; total: number };
export type PlanReferences = { memberRequests: number; payments: number; workouts: number; conversations: number; channels: number };
export interface MemberPlanRepository {
  findPage(query: { name?: string; memberTypeId?: number; status?: Status; limit: number; offset: number }): Promise<MemberPlanPage>;
  findById(id: number): Promise<MemberPlanRecord | null>;
  memberTypeExists(id: number): Promise<boolean>;
  durationById(id: number): Promise<{ id: number; value: number } | null>;
  relationsExist(kind: 'pros' | 'cons', ids: number[]): Promise<boolean>;
  references(id: number): Promise<PlanReferences>;
  create(input: MemberPlanCreateData): Promise<MemberPlanRecord>;
  update(id: number, input: MemberPlanUpdateData): Promise<MemberPlanRecord>;
  delete(id: number): Promise<void>;
}
export type MemberPlanCreateData = { name: string; memberTypeId: number; durationId: number; duration: number; price: number; prosIds: number[]; consIds: number[]; isVideoGroup: boolean; status: Status; actorId: number };
export type MemberPlanUpdateData = Partial<Omit<MemberPlanCreateData, 'actorId' | 'duration'>> & { duration?: number; actorId: number };
const include = { memberType: { select: { id: true, name: true, status: true } }, planDuration: { select: { id: true, name: true, value: true } }, pros: { select: { id: true, name: true } }, cons: { select: { id: true, name: true } } };
export class PrismaMemberPlanRepository implements MemberPlanRepository {
  public async findPage(query: { name?: string; memberTypeId?: number; status?: Status; limit: number; offset: number }): Promise<MemberPlanPage> { const prisma = getPrismaClient(); const where: Prisma.MemberPlanWhereInput = { ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}), ...(query.memberTypeId ? { memberTypeId: query.memberTypeId } : {}), ...(query.status ? { status: query.status } : {}) }; const [records, total] = await prisma.$transaction([prisma.memberPlan.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }), prisma.memberPlan.count({ where })]); return { records, total }; }
  public async findById(id: number): Promise<MemberPlanRecord | null> { return getPrismaClient().memberPlan.findUnique({ where: { id }, include }); }
  public async memberTypeExists(id: number): Promise<boolean> { return Boolean(await getPrismaClient().memberType.findUnique({ where: { id }, select: { id: true } })); }
  public async durationById(id: number): Promise<{ id: number; value: number } | null> { return getPrismaClient().planDuration.findUnique({ where: { id }, select: { id: true, value: true } }); }
  public async relationsExist(kind: 'pros' | 'cons', ids: number[]): Promise<boolean> { if (!ids.length) return true; const count = kind === 'pros' ? await getPrismaClient().pros.count({ where: { id: { in: ids } } }) : await getPrismaClient().cons.count({ where: { id: { in: ids } } }); return count === ids.length; }
  public async references(id: number): Promise<PlanReferences> { const p = getPrismaClient(); const [memberRequests, payments, workouts, conversations, channels] = await Promise.all([p.memberRequest.count({ where: { memberPlanId: id } }), p.payment.count({ where: { memberPlanId: id } }), p.workout.count({ where: { memberPlanId: id } }), p.conversation.count({ where: { memberPlanId: id } }), p.channel.count({ where: { memberPlanId: id } })]); return { memberRequests, payments, workouts, conversations, channels }; }
  public async create(input: MemberPlanCreateData): Promise<MemberPlanRecord> { return getPrismaClient().memberPlan.create({ data: { name: input.name, memberTypeId: input.memberTypeId, durationId: input.durationId, duration: input.duration, price: input.price, isVideoGroup: input.isVideoGroup, status: input.status, createdById: input.actorId, pros: { connect: input.prosIds.map((id) => ({ id })) }, cons: { connect: input.consIds.map((id) => ({ id })) }, }, include }); }
  public async update(id: number, input: MemberPlanUpdateData): Promise<MemberPlanRecord> { return getPrismaClient().memberPlan.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.memberTypeId !== undefined ? { memberTypeId: input.memberTypeId } : {}), ...(input.durationId !== undefined ? { durationId: input.durationId, duration: input.duration } : {}), ...(input.price !== undefined ? { price: input.price } : {}), ...(input.isVideoGroup !== undefined ? { isVideoGroup: input.isVideoGroup } : {}), ...(input.status !== undefined ? { status: input.status } : {}), ...(input.prosIds !== undefined ? { pros: { set: input.prosIds.map((id) => ({ id })) } } : {}), ...(input.consIds !== undefined ? { cons: { set: input.consIds.map((id) => ({ id })) } } : {}), updatedById: input.actorId }, include }); }
  public async delete(id: number): Promise<void> { await getPrismaClient().memberPlan.delete({ where: { id } }); }
}
