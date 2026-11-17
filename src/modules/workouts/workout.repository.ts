import type { Prisma, Status } from '@prisma/client';

import { getPrismaClient } from '../../database/prisma.js';

export type WorkoutQuery = { name?: string; categoryId?: number; memberPlanId?: number; status?: Status; limit: number; offset: number };
export type WorkoutRecord = { id: number; name: string; video: string; thumbnail: string | null; gender: string; workoutDay: string | null; videoDuration: number; sets: number | null; reps: number | null; status: string; createdAt: Date; category: { id: number; name: string }; bodyGoal: { id: number; name: string }; proficientLevel: { id: number; name: string }; place: { id: number; name: string }; memberPlan: { id: number; name: string } };
export type WorkoutPage = { records: WorkoutRecord[]; total: number };
export type WorkoutMetadataUpdate = { name?: string; gender?: 'MALE' | 'FEMALE' | 'BOTH'; workoutDay?: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY'; sets?: number; reps?: number; status?: 'ACTIVE' | 'INACTIVE'; updatedById: number };
export interface WorkoutRepository { findPage(query: WorkoutQuery): Promise<WorkoutPage>; findById(id: number): Promise<WorkoutRecord | null>; updateMetadata(id: number, update: WorkoutMetadataUpdate): Promise<WorkoutRecord | null>; }

const select = { id: true, name: true, video: true, thumbnail: true, gender: true, workoutDay: true, videoDuration: true, sets: true, reps: true, status: true, createdAt: true, category: { select: { id: true, name: true } }, bodyGoal: { select: { id: true, name: true } }, proficientLevel: { select: { id: true, name: true } }, place: { select: { id: true, name: true } }, memberPlan: { select: { id: true, name: true } } } satisfies Prisma.WorkoutSelect;
const whereFor = (query: WorkoutQuery): Prisma.WorkoutWhereInput => ({ ...(query.name ? { name: { contains: query.name, mode: 'insensitive' } } : {}), ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.memberPlanId ? { memberPlanId: query.memberPlanId } : {}), ...(query.status ? { status: query.status } : {}) });

export class PrismaWorkoutRepository implements WorkoutRepository {
  public async findPage(query: WorkoutQuery): Promise<WorkoutPage> { const prisma = getPrismaClient(); const where = whereFor(query); const [records, total] = await prisma.$transaction([prisma.workout.findMany({ where, select, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit }), prisma.workout.count({ where })]); return { records, total }; }
  public async findById(id: number): Promise<WorkoutRecord | null> { return getPrismaClient().workout.findUnique({ where: { id }, select }); }
  public async updateMetadata(id: number, update: WorkoutMetadataUpdate): Promise<WorkoutRecord | null> { const prisma = getPrismaClient(); const existing = await prisma.workout.findUnique({ where: { id }, select: { id: true } }); if (!existing) return null; return prisma.workout.update({ where: { id }, data: { ...(update.name !== undefined ? { name: update.name } : {}), ...(update.gender !== undefined ? { gender: update.gender } : {}), ...(update.workoutDay !== undefined ? { workoutDay: update.workoutDay } : {}), ...(update.sets !== undefined ? { sets: update.sets } : {}), ...(update.reps !== undefined ? { reps: update.reps } : {}), ...(update.status !== undefined ? { status: update.status } : {}), updatedById: update.updatedById }, select }); }
}
