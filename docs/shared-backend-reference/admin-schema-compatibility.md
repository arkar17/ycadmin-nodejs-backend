# Admin API v1 compatibility with the shared mobile-backend schema

## Scope and evidence

This is a read-only assessment of [`schema.prisma`](./schema.prisma), compared with the Admin API SRS, REST specification, database-mapping requirements, dashboard specification, authentication requirements, and open-decision record in `/Users/arkar/Desktop/admin-site/docs/admin-nodejs-v1/`.

No database was contacted, no Prisma Client was generated, and no migration or schema change was made. A field described below is **confirmed only as present in this schema**; its runtime data quality, deployed migration state, storage semantics, and mobile-service behavior remain unverified.

## Schema inventory

The schema uses PostgreSQL and defines a single-column `id Int @id @default(autoincrement())` primary key on every model. There are no compound primary keys. All relationship links below are Prisma relations over integer foreign-key fields unless noted otherwise.

| Domain | Models and confirmed relationship shape |
|---|---|
| Administration / RBAC | `User` has unique `email` and `username`, self-referencing `createdBy`/`updatedBy`, and many `UserRole` assignments. `Role` and `Permission` have unique names. `UserRole` bridges User–Role; `RolePermission` bridges Role–Permission. |
| Membership catalogue | `MemberType` has many `Member`, `MemberPlan`, `MemberRequest`, and `Payment`. `MemberPlan` belongs to one `MemberType`, optionally one `PlanDuration`, and has many `Pros`, `Cons`, `Workout`, `Payment`, `MemberRequest`, `Conversation`, and `Channel` records. `Pros` and `Cons` are implicit many-to-many relations with `MemberPlan`. `PlanDuration` has many plans and shop levels. |
| Member / identity | `Member` has unique `code`, nullable-unique `email`, `phone`, and `appleId`; optional `MemberType`, `BodyGoal`, and `ProficientLevel`; optional one-to-one `MemberProfile`, `BodyMeasurement`, `MemberFcmToken`, and `Shop`; and one-to-many links to requests, payments, attendance, feedback, and mobile/social data. `MemberProfile` has a unique `memberId` and one-to-many `memberProfilePhoto` records. `MemberProviderType` is a member/provider bridge. `OTP` is standalone. |
| Requests and payments | `MemberRequest` belongs to `Member`, `MemberType`, and `MemberPlan`; it has optional approving/rejecting `User` relations and many `Payment` records. `Payment` belongs to `Member` and `BankInformation`, and optionally to a member plan/type, shop level, member request, or shop-upgrade request. `ShopUpgradeRequest` is a separate approval workflow. |
| Attendance / payment destination / feedback | `Attendance` belongs to `Member`, has optional creating/updating `User`, a string `date`, nullable `qrToken`, and timestamps. `BankInformation` has payment records and optional creating/updating Users. `ClientFeedback` belongs to `Member` and has a `name` field plus timestamps. |
| Workout / fitness reference data | `Workout` belongs to required `Category`, `BodyGoal`, `ProficientLevel`, `Place`, and `MemberPlan`; it has `Gender`, optional `Day`, video fields, sets/reps, and status. `BodyGoal`, `ProficientLevel`, `Category`, and `Place` are named reference models. `PhysicalLimitation`, `DietType`, `BodyAttentionArea`, `Meal`, `MealTracker`, `BadHabit`, `WaterTracker`, `WeightHistory`, `PersonalWorkoutHistory`, and `MemberFitnessSurvey` are present but not required by the current Admin scope. |
| Shop and social | `ShopLevel`, `Shop`, `ShopUpgradeRequest`, `ShopRating`, `Post`, `MemberPostMediaHistory`, `PostCategory`, `PostSave`, `PostReaction`, `PostComment`, `PostCommentReaction`, `FriendRequest`, `Friend`, `Follow`, `Notification`, `PostReport`, and `PostViews` support mobile social/shop workflows. |
| Messaging | Legacy `Conversation`, `ConversationParticipant`, `Message`, and `MessageReaction` are present. The newer channel system comprises `Channel`, `ChannelParticipant`, `ChannelMessage`, `ChannelMessageAttachment`, `ChannelMessageHidden`, `ChatReact`, `ChannelMessageReact`, and `Block`. |
| System / content | `ReportCategory`, `SystemParameter`, and `Dashboard` exist. `Dashboard` is a unique-by-type text-content model for `privacy_policy` and `term_condition`; it is **not** an operational KPI source. |

### Enums

| Enum | Values |
|---|---|
| `Status` | `ACTIVE`, `INACTIVE` |
| `MemberRequestStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `PaymentStatus` | `DRAFT`, `ACCEPT`, `DECLINE` |
| `PaymentRequestType` | `MEMBER_PLAN_UPGRADE`, `SHOP_LEVEL_UPGRADE` |
| `PaymentTypes` | `BANK_ACCOUNT`, `E_WALLET` |
| `ClientType` | `user`, `gym_member`, `trainer`, `king`, `queen`, `admin` |
| `Gender` | `MALE`, `FEMALE`, `BOTH` |
| `Day` | `SUNDAY` through `SATURDAY` |
| `ProviderType` | `GOOGLE`, `FACEBOOK`, `APPLE`, `EMAIL`, `PHONE` |
| `Language` | `ENG`, `MM` |
| `Theme` | `DARK`, `PINK`, `LIGHT` |
| `memberProfilePhotoType` | `COVER`, `PROFILE` |
| `MemberPostMediaPostType` | `SOCIAL`, `SHOP` |
| `PrivencyType` | `PUBLIC`, `FRIEND`, `ONLY_ME` |
| `NotificationType` | `SOCIAL`, `SYSTEM`, `ACTIVITY` |
| `ConversationType` | `PRIVATE`, `GROUP`, `TRAINER_GROUP` |
| `ConversationStatus` | `REQUESTED`, `ACCEPTED`, `CANCELED` |
| `ParticipantRole` | `ADMIN`, `MEMBER` |
| `ChannelCategory` | `SOCIAL`, `FITNESS` |
| `ChannelType` | `ONE_TO_ONE`, `GROUP` |
| `ChannelStatus` | `ACTIVE`, `INACTIVE`, `CLOSED` |
| `ChannelChatAction` | `REQUEST`, `CANCEL`, `ACCEPT`, `ARCHIVE`, `DISABLE` |
| `ChannelMessageType` | `TEXT`, `PHOTOS`, `VIDEOS`, `AUDIO` |
| `DashboardType` | `privacy_policy`, `term_condition` |
| Fitness-survey enums | `BodyGoalType` (`weight_gain`, `weight_loss`, `beauty`), `BodyType`, `EngergyLevel` (schema spelling), `DailyLife`, `AverageNight`, `PhysicalActivity`, `PreferredActivity`, `LastIdeaWeight`, `DailyWaterIntake`, and `ProficientLevelType` (`beginner`, `advanced`, `professional`) |
| `DeviceType` | `ANDROID`, `IOS`, `WEB` |

### Declared uniqueness and secondary indexes

Primary keys and scalar unique fields are declared on `User.email`, `User.username`, `Role.name`, `Permission.name`, `MemberType.name`, `Pros.name`, `Cons.name`, `Member.code`, `Member.email`, `Member.phone`, `Member.appleId`, `MemberFcmToken.memberId`, `ReportCategory.name`, `MemberProfile.memberId`, `ShopLevel.name`, `Shop.memberId`, `PostCategory.name`, `BodyGoal.name`, `ProficientLevel.name`, `Category.name`, `Place.name`, `ChatReact.reactCode`, `SystemParameter.key`, and `PlanDuration.value`.

Composite uniqueness is declared for User–Role, Role–Permission, member/token, OTP email/OTP, OTP phone/OTP, member/provider, member/shop rating, post saves/reactions/comment reactions/views, friend request/friend/follow/block pairs, conversation/channel participants, message reactions/hidden records/channel reactions, and `Dashboard.type`.

The only explicitly declared non-unique indexes relevant to present or potential Admin reads are:

- `Attendance @@index([memberId, createdAt])` — useful for one member’s chronological history, but not for global date-range dashboard/list scans.
- `MemberPostMediaHistory @@index([memberId, postType, createdAt])` — mobile-social only.
- Channel-message and attachment indexes — messaging only.

There is no declared index on `Member.createdAt`, `MemberRequest.createdAt` or `status`, `Payment.status` or `requestDate`, `Attendance.date`, `Workout` filters, or `ClientFeedback.createdAt`. Database-level indexes can exist outside the checked schema, but this source does not prove them.

## Confirmed Admin module mappings

| Admin module / REST resource | Confirmed schema mapping | Compatible fields | Gaps and required caution |
|---|---|---|---|
| Authentication | `User`, `Role`, `Permission`, `UserRole`, `RolePermission` | `User.id`, `name`, `username`, `password`, `status`; role/permission relations | This proves RBAC data structures, not password hashing, login behavior, JWT issuer/claims, refresh/revocation, session persistence, or which roles are administrators. `Member.clientType = admin` is a separate model and must not be assumed equivalent to `User`. |
| Members / proposed `/users` | `Member` + optional `MemberProfile`, `MemberType` | Canonical member ID, `code` (client code), name, email, phone, country code, `clientType`, status, created timestamp; profile address and gender/profile-photo fields | There is no direct active `MemberPlan` relation. `Attendance.memberId` makes `Member.id` a strong candidate for the attendance subject, but owner confirmation is still needed. Profile fields are optional and URLs/keys are raw storage data, not automatically authorized URLs. |
| Membership requests | `MemberRequest` + `Member`, `MemberPlan`, `MemberType`, optional approver/rejector `User`, `Payment[]` | Request ID, member/plan/type, PENDING/APPROVED/REJECTED status, rejection reason, approver/rejector IDs and timestamps, created/updated timestamps | No request number, direct duration, price snapshot, confirmed/expiry timestamp, or proof field exists. `Payment.attachment` may be related through `memberRequestId`, but cardinality, request type, and authoritative-proof selection are not defined here. Frontend/Odoo `draft`/`paid` do not equal schema enum values without a product mapping. |
| Member plans | `MemberPlan`, `MemberType`, `PlanDuration`, `Pros`, `Cons` | ID, name, image string, member type, price integer, duration and optional duration relation, video-group flag, active/inactive status, Pros/Cons relations, audit timestamps/users | There is no `dataType` string, `levelId`, plan-level relation, money/currency metadata, or media key. `duration` (integer) and optional `durationId` both exist and their intended precedence is unknown. Deletes can affect dependent relations and need an owner-defined retention policy. |
| Member types / planned levels | `MemberType` is a named type catalogue; `ProficientLevel` is a workout/member fitness reference type | Both have IDs, unique names, status, timestamps; `MemberType` links to plans and members | No model contains the REST `plan-level-types` fields `levelCount` or `postLimitCount`. `ProficientLevel` is not a demonstrated replacement, and it does not connect to `MemberPlan`. This endpoint is blocked. |
| Plan durations | `PlanDuration` | ID, name, unique integer `value`, timestamps; referenced by plans and shop levels | No status or audit fields. Create/update are structurally possible, but referential-delete behavior and the unit of `value` require confirmation. |
| Bank information | `BankInformation` | ID, name, `coverPhoto`, account holder/number, phone, `PaymentTypes`, active/inactive status, audit fields | API values must map deliberately to `BANK_ACCOUNT` and `E_WALLET`; no generic `bank` value is stored. No image key, encryption/masking flag, display-order field, or storage/access policy is present. Account data is sensitive. |
| Attendance | `Attendance` + `Member` | ID, `memberId`, string `date`, nullable `qrToken`, `createdAt`, creating/updating User; member name/code/contact/type through relation | `date` is not a timezone-aware timestamp; `createdAt` is the only timestamp. No source, branch, eligibility, active-plan link, or duplicate-prevention unique constraint exists. `qrToken` is plaintext and there is no credential lifecycle model. List reads can be designed only after deciding whether `date` or `createdAt` is authoritative. Manual creation and QR operations remain blocked. |
| QR | Only nullable `Attendance.qrToken`; `SystemParameter` is generic but has no documented QR semantics | None sufficient for a credential contract | No token issuer, hash, expiry, rotation, revocation, ownership, or mobile-validation relation. Do not use `SystemParameter` or a raw attendance token as a substitute without the mobile owner’s contract. |
| Feedback | `ClientFeedback` + `Member` | ID, member relation, `name`, created/updated timestamps; client code via member | The schema does not identify whether `ClientFeedback.name` is the feedback message expected by REST, and has no state/moderation fields. Read-only list/detail can follow after confirming the field’s business meaning. |
| Workouts | `Workout` + `MemberPlan`, `Category`, `BodyGoal`, `ProficientLevel`, `Place` | ID, name, video/thumbnail strings, gender, category, goal, proficiency, place, required plan, optional day, duration seconds, sets, reps, active/inactive status, audit fields | No `isFreeVideo`, calories/burn-calory, workout state beyond `Status`, storage key, MIME/size, or upload policy. `memberPlanId` is required, unlike the proposed nullable DTO. CRUD is structurally available only after media and enum/field mapping decisions. |
| Dashboard | `Member`, `MemberRequest`, `Attendance`, `MemberPlan`, optionally `Payment` | See metric analysis below | There is no membership entitlement/activation/expiry model. The existing `Dashboard` model is static legal text, not analytics. |

## Dashboard metric evidence

| Proposed metric | Schema-supported source | Assessment |
|---|---|---|
| Users | `Member.createdAt`; filter before period end | Technically calculable once “user” is confirmed to mean `Member`, rather than `User` or a subset of `Member.clientType`. |
| New users | `Member.createdAt` within timezone-derived period | Technically calculable, subject to the same identity-scope and timestamp-timezone decisions. No supporting index is declared. |
| Membership requests | `MemberRequest.createdAt`, `status`, `memberPlanId` | Count and current-status partition are calculable. The schema cannot reconstruct historical status-at-period-end because it has no status-event history. |
| Recent membership requests | `MemberRequest.createdAt` with `Member` and `MemberPlan` relations | Structurally available, but request number and Odoo status vocabulary are unavailable. |
| Attendance visits | `Attendance.createdAt` and/or string `date` | A count is possible only after confirming which field represents check-in time and the `date` format/timezone. No global date index is declared. |
| Recent attendance | `Attendance.createdAt` + `Member` | Structurally available; no reliable `source` field exists for the proposed response. |
| Attendance today | Same as attendance, after timezone policy | Blocked by `date` semantics and lack of a confirmed event-time rule; `createdAt` may be an insertion timestamp rather than attendance time. |
| Members active at period end | No canonical entitlement/membership record | Not supported. `Member.memberType`, `MemberPlan`, approved request, or accepted payment cannot safely be treated as active membership. |
| New / existing members | No first-activation event or entitlement lifecycle | Not supported. |
| Membership distribution | No active member-to-plan relation | Not supported. `Payment.memberPlanId` is purchase/request-oriented and has no effective/end dates; it is insufficient proof of current membership. |
| Monthly trend new members | No activation history | Not supported; trends for new users, requests, and attendance could be produced after the preceding timestamp decisions. |

## Missing, ambiguous, and conflicting areas

1. **No active-membership domain model.** There is no member-plan assignment/entitlement with effective start, expiry, cancellation, renewal, or active status. This blocks the central membership metrics and makes a member’s current plan unavailable from `Member`.
2. **Request/payment semantics are not the frontend contract.** Schema states are `PENDING`/`APPROVED`/`REJECTED` for requests and `DRAFT`/`ACCEPT`/`DECLINE` for payments, rather than Odoo `draft`/`paid`/`rejected`. Approval side effects, price snapshot, proof selection, and expiry are absent from the schema evidence.
3. **Plan levels are missing.** No relation or model supports the planned `levelId`, `levelCount`, or `postLimitCount`; `ProficientLevel` serves workouts and member fitness, not plan levels.
4. **QR implementation is absent.** `Attendance.qrToken` is not a QR credential model and storing it raw creates a material security concern. No endpoint must expose or rotate it until mobile validation is confirmed.
5. **Attendance rules are underspecified.** String `date`, timestamp `createdAt`, no unique constraint, no branch/source, and no entitlement relation cannot establish duplicate or eligibility rules.
6. **Media semantics are underspecified.** Images, payment attachments, profile assets, and workout video are strings; only profile/channel assets sometimes have a separate key. No media metadata, ownership, signed URL, MIME, size, scan, or retention policy is represented.
7. **Two identity domains exist.** `User` is the natural administrative/RBAC entity while `Member` is the customer/mobile entity. They have separate primary keys and no direct relation. The Admin API must not use `Member.clientType` as authorization evidence or return `User.password`/`Member.password`.
8. **Read performance needs validation.** Most intended global Admin filters and dashboard aggregations lack declared indexes. Add no index or migration from this workspace; profile an isolated environment and coordinate any schema change with the mobile owner.
9. **Delete behavior can conflict with mobile operations.** Some links explicitly cascade, while many Admin-relevant links use default referential behavior. Feature endpoints must use the existing mobile service/repository conventions and avoid direct destructive CRUD assumptions.
10. **Reference-schema completeness is not proven.** The datasource declares only `provider = "postgresql"`; it has no URL in this file. The reference may rely on external Prisma configuration. Deployed migrations, database constraints outside Prisma, and code-level authorization remain unknown.

## Endpoint readiness

| Readiness | Endpoints |
|---|---|
| **Potentially implementable after auth/DTO decisions** | `GET /users`, `GET /member-plans`, `GET /member-plans/:id`, `GET /plan-durations`, `GET /bank-information`, `GET /attendance`, `GET /feedback`, `GET /feedback/:id`, `GET /workouts`, `GET /workouts/:id`, and read-only request list/detail. Each still needs authorization, pagination, DTO mapping, field-meaning confirmation, and isolated non-production integration tests. |
| **Structurally possible but requires explicit owner decisions** | Login/session routes using `User`/RBAC; create/update plans, durations, bank information, and workouts; request approval/rejection. These depend on existing password/session conventions, media handling, referential deletion rules, audit conventions, and—in request decisions—transactional membership/payment behavior. |
| **Blocked by absent or insufficient schema evidence** | `GET /plan-level-types` and its mutations; membership-request fields for number/price snapshot/expiry/proof; manual attendance; all QR endpoints; dashboard active/new/existing-member and distribution metrics; any mutation that assumes an active membership or expiry. |

## Safe Prisma integration strategy for this standalone workspace

1. Treat this file as a **reference contract**, not a schema to extend or a source of permission to alter the shared database.
2. Obtain the mobile backend owner’s exact schema revision, migration history, Prisma configuration, generated-client convention, repository/service patterns, and non-production database access policy. Confirm that it is the deployed schema before generating a client.
3. Bring the verified schema into this repository through a versioned, reviewable mechanism approved by the owner (for example a pinned shared package or read-only synchronized copy). Record its source revision and do not hand-edit it in the Admin workspace.
4. Configure the Admin app to generate Prisma Client locally from that exact schema only after the preceding approval. Keep generated output local/ignored; never point generation, `db push`, or migration commands at a shared database.
5. Use a separate isolated development/test PostgreSQL database populated only with approved sanitized fixtures. `DATABASE_URL` must remain local/non-production. Do not connect the Admin workspace to production or the live mobile database.
6. Implement repositories behind DTO mappers so Prisma model and storage field names never leak to the Admin REST contract. Reuse or call owner-approved shared business services for approvals, attendance, QR, and media rather than duplicating their writes.
7. Start with a schema-backed, read-only endpoint such as the member directory only after confirming the authorization middleware and member/attendance identifiers. Add contract, authorization, and no-data tests against the isolated database before enabling mutations.

## Summary

Confirmed mappings are strongest for RBAC storage (`User`/roles/permissions), member directory data (`Member` plus `MemberProfile`), plans/durations, bank information, attendance records, feedback records, workouts, and request/payment records. The schema also confirms the principal relational boundaries and integer IDs needed to build DTO mappers.

The critical blockers are the absent active-membership entitlement lifecycle, missing plan-level model, absent QR credential contract, unresolved authentication/session implementation, ambiguous payment/request side effects, attendance-time semantics, and media/audit policies. Dashboard user/request/attendance components have partial sources, but membership KPIs and distribution must not be implemented from this schema alone.

The safest next implementation step is to obtain the shared backend’s approved auth/service conventions and schema revision, then implement and test one **read-only member-directory slice** against an isolated non-production database. Do not begin approval, QR, dashboard-membership, or mutation work until their owner-confirmed business contracts exist.
