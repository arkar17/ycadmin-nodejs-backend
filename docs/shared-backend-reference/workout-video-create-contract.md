# Workout Video Create Contract — Phase 3L

## Outcome

`POST /api/admin/v1/workout-videos` remains **deferred and unregistered**. The copied mobile backend establishes the database shape and legacy playback representation, but it does not provide a safe Admin upload contract that the standalone Admin API can reuse.

No application source, Prisma schema, migration, storage object, mobile backend file, or frontend file was changed in Phase 3L.

## Confirmed database create requirements

The authoritative model is `Workout` in the shared schema.

| Field | Requirement | Evidence |
| --- | --- | --- |
| `video` | Required string storage reference | `prisma/schema.prisma:799-838` |
| `thumbnail` | Optional string storage reference | same |
| `name` | Required | same |
| `gender` | Required `MALE`, `FEMALE`, or `BOTH` | same |
| `categoryId`, `bodyGoalId`, `proficientLevelId`, `placeId`, `memberPlanId` | Required foreign keys | same |
| `workoutDay` | Nullable `Day` enum | same |
| `videoDuration` | Integer seconds, default `0` | same |
| `sets`, `reps` | Nullable integers | same |
| `status` | `ACTIVE` or `INACTIVE`, defaults to `ACTIVE` | same |
| `createdById` | Optional User audit relation; must be set only from authenticated Admin context | same |

`PersonalWorkoutHistory.workoutId` cascades on deletion. Creation does not affect history, but physical delete is unsafe and remains unavailable.

## Verified legacy media behavior

The mobile backend applies global `multer.memoryStorage()` to every `/api` route (`app/index.ts:10-25`). Workout creation takes `video` and optional `thumbnail` files from this in-memory collection, calls `upload(videoFile, "workout-videos")`, then calls `upload(thumbnailFile, "workout-thumbnails")` unconditionally (`app/services/admin/v1/workout.service.ts:315-356`).

The upload helper (`app/helpers/media-upload.ts:54-149`) currently:

- accepts arbitrary file types; it has no allowlist, magic-byte inspection, filename normalization policy, or antivirus scanning;
- permits files through memory up to 10 GiB;
- derives extension directly from `originalname`;
- creates UUID-based object keys under the caller-supplied folder;
- uses S3-compatible configuration from `OSS_*` environment variables, a hardcoded bucket name, S3 path style, and `ACL: public-read`;
- stores a constructed public Spaces URL in `Workout.video`/`Workout.thumbnail`;
- falls back to public local disk URLs when storage credentials are absent;
- has no storage-object deletion helper and no compensation when a later upload or Prisma create fails.

The helper’s public URL construction and hardcoded bucket are legacy implementation details, not an approved Admin storage convention. Credential values were not read or displayed.

The copied mobile service also writes the fixed value `12121` to `videoDuration` on both create and update. This is not reliable duration extraction and must not be reproduced. Member APIs return stored `video`/`thumbnail` values directly and only expose `ACTIVE` workouts (`app/services/member/v1/fitness/workout.service.ts:6-111`; member workout resource). This confirms playback compatibility depends on an already valid stored reference, but does not authorize creating new public references.

## Existing frontend create form requirements

The React Odoo adapter submits multipart data with a required browser `video` file on create and fields such as `workout_name`, `is_free_video`, `main_goal`, `proficient_level`, `category`, `gender`, `burn_calory`, `place`, `workout_day`, `sets_count`, `reps_count`, and `member_plan_id` (`src/api/workoutApi.ts:160-267`; `src/pages/WorkoutVideosPage.tsx`).

Only the following concepts can be mapped to the verified schema after a reference-data mapping is approved: name, gender, day, sets, reps, member-plan relation, and the four required taxonomy relations. The frontend fields `is_free_video` and `burn_calory` have no `Workout` columns. Its category/goal/proficiency/place values are hardcoded labels, not verified IDs.

The current Admin API already has Member Plan listing. It has no verified protected Admin read endpoint for Category, BodyGoal, ProficientLevel, or Place, and no confirmed permission catalog for such a new aggregate reference-data endpoint. No redundant endpoint was added.

## Minimum safe future create contract

Once approved, the Admin endpoint should accept multipart files—not arbitrary caller-supplied URLs—and require:

1. Active Admin JWT plus `workout:create`.
2. Required video and optional thumbnail, with bounded streaming upload (not global memory buffering), field-count limits, content-type allowlists confirmed by content inspection, size limits, safe filename handling, and malware/media scanning policy.
3. Server-derived verified video duration in seconds, or an explicitly approved asynchronous processing state. Clients must never supply duration or audit fields.
4. Active, validated IDs for Category, BodyGoal, ProficientLevel, Place, and MemberPlan, with documented compatibility rules for each relation.
5. A shared storage configuration owned by the backend operator, with private/public access policy, bucket/key convention, object metadata, and approved playback delivery strategy.
6. A compensating delete/quarantine process if any upload succeeds but a later upload or database transaction fails. Database insertion and object finalization must be designed for retry/idempotency.
7. A DTO that returns an authorized playback representation without inventing public URLs.

## Exact blockers

1. Approval of the new Admin storage contract: bucket/region/endpoint ownership, private versus public workout-media policy, and server secret provisioning.
2. Approved MIME, magic-byte, size, duration-extraction, virus-scanning, and transcoding policy for video and thumbnails.
3. Object lifecycle/rollback procedure for partial upload and failed database creation.
4. Canonical Category, BodyGoal, ProficientLevel, and Place lookup/mapping contract for the current frontend.
5. Product decision for Odoo-only `is_free_video` and `burn_calory` fields.

Until these are approved, accepting a raw storage URL, copying the legacy public-read implementation, relying on browser MIME checks, or generating a fixed duration would be unsafe.
