import { AppError } from '../../shared/app-error.js';
import type { WorkoutListQuery, WorkoutUpdateInput } from './workout.schema.js';
import type { WorkoutRecord, WorkoutRepository } from './workout.repository.js';

type Relation = { id: number; name: string };
export type WorkoutItem = { id: number; name: string; video: string; thumbnail: string | null; gender: string; category: Relation; bodyGoal: Relation; proficientLevel: Relation; place: Relation; memberPlan: Relation; workoutDay: string | null; videoDurationSeconds: number; sets: number | null; reps: number | null; status: string; createdAt: string };
export class WorkoutService {
  public constructor(private readonly repository: WorkoutRepository) {}
  public async list(query: WorkoutListQuery): Promise<{ data: WorkoutItem[]; total: number }> { const page = await this.repository.findPage({ name: query.name ?? query.workoutName ?? query.workout_name, categoryId: query.categoryId, memberPlanId: query.memberPlanId ?? query.member_plan_id, status: query.status, limit: query.limit, offset: query.offset }); return { data: page.records.map(this.toItem), total: page.total }; }
  public async detail(id: number): Promise<WorkoutItem> { const workout = await this.repository.findById(id); if (!workout) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Workout was not found.' }); return this.toItem(workout); }
  public async update(id: number, input: WorkoutUpdateInput, adminId: number): Promise<WorkoutItem> { const workout = await this.repository.updateMetadata(id, { ...input, updatedById: adminId }); if (!workout) throw new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'Workout was not found.' }); return this.toItem(workout); }
  private readonly toItem = (workout: WorkoutRecord): WorkoutItem => ({ id: workout.id, name: workout.name, video: workout.video, thumbnail: workout.thumbnail, gender: workout.gender, category: workout.category, bodyGoal: workout.bodyGoal, proficientLevel: workout.proficientLevel, place: workout.place, memberPlan: workout.memberPlan, workoutDay: workout.workoutDay, videoDurationSeconds: workout.videoDuration, sets: workout.sets, reps: workout.reps, status: workout.status, createdAt: workout.createdAt.toISOString() });
}
