# Workout Videos Compatibility — Phase 3J

## Confirmed schema mapping

The shared Prisma model is `Workout`, not a separate `WorkoutVideo` model. It has required `name`, `video`, `gender`, `categoryId`, `bodyGoalId`, `proficientLevelId`, `placeId`, and `memberPlanId`; optional `thumbnail`, `workoutDay`, `sets`, and `reps`; plus `videoDuration`, `status`, audit IDs, and timestamps.

Confirmed relations are `Category`, `BodyGoal`, `ProficientLevel`, `Place`, and `MemberPlan`. `PersonalWorkoutHistory.workoutId` is `onDelete: Cascade`, so deleting a workout also deletes Member history. This makes physical delete unsafe for the Admin API without an approved retention decision.

## Supported Admin API surface

- `GET /api/admin/v1/workout-videos` — enabled; requires `workout:list`.
- `GET /api/admin/v1/workout-videos/:id` — enabled; requires `workout:read`.
- `PATCH /api/admin/v1/workout-videos/:id` — enabled; requires `workout:update`. It accepts only `name`, `gender`, `workoutDay`, positive integer `sets`/`reps`, and `status`.

Both use current database-backed Admin authorization, bounded offset pagination, deterministic `createdAt DESC, id DESC` ordering, safe DTOs, and verified filters: workout name, numeric category ID, numeric Member Plan ID, and status. Legacy frontend aliases `workout_name` and `member_plan_id` are accepted.

## Deferred mutations

`POST` and `DELETE` are intentionally not registered. `PATCH` is restricted to the metadata/status subset above.

1. A new Workout requires a video reference, but the shared model records only a string. The mobile implementation directly uploads multipart files to object storage; no approved Admin upload validation, private-object policy, signing policy, duration extraction policy, or malware/size/MIME inspection contract is available.
2. The current mobile service writes a fixed `videoDuration` value and exposes stored media values directly. Reusing that behavior would be unsafe and not an authoritative media rule.
3. Updating plan/category/goal/proficiency/place changes mobile-facing eligibility/content semantics. These relationship changes remain deferred pending owner-approved business rules.
4. Deleting cascades `PersonalWorkoutHistory`, destroying historical Member activity. There is a `status` field, but treating it as an approved archival/soft-delete workflow requires a product decision; no such behavior is invented here.
5. The Odoo frontend fields `is_free_video` and `burn_calory` have no verified `Workout` fields. Its hardcoded category and enum values are UI declarations, not schema mappings.

## Disable behavior

`status` is the verified `ACTIVE | INACTIVE` enum. The Member workout services query only `ACTIVE` workouts, including when creating personal-workout history. Therefore, an Admin can safely set a workout to `INACTIVE`: it hides the workout from Member discovery/new history creation while preserving the Workout row, stored media references, and existing `PersonalWorkoutHistory` rows. Reactivating it is allowed through the same guarded PATCH endpoint.

## Media handling

List/detail return the stored `video` and optional `thumbnail` reference as opaque values; the Admin API does not construct public URLs, fetch objects, generate signed URLs, or delete storage objects. A future media design must establish access controls, upload authorization, content inspection, lifecycle retention, and a client-safe retrieval strategy.

## Reference evidence

- Shared schema: `prisma/schema.prisma` (`Workout`, `PersonalWorkoutHistory`).
- Existing mobile Admin route/service/schema: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/admin/v1/workout.route.ts`, `app/services/admin/v1/workout.service.ts`, and `app/schemas/admin/v1/workout.schema.ts`.
- Confirmed permission seed names: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts`.
- Frontend migration evidence: `/Users/arkar/Desktop/admin-site/src/api/workoutApi.ts` and `src/pages/WorkoutVideosPage.tsx`.
