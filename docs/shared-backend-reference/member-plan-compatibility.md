# Member Plan compatibility and safe REST subset

| Odoo field | Verified mapping | API decision |
|---|---|---|
| `name` | `MemberPlan.name` | Supported |
| `data_type` | None. `MemberType` is an entity, not the frontend enum `member|trainer|shop`. | Unsupported; use explicit `memberTypeId` |
| `price` | `MemberPlan.price` integer | Supported |
| `duration_id` | `MemberPlan.durationId → PlanDuration` | Supported as `durationId`; API copies `PlanDuration.value` to required `MemberPlan.duration` |
| `level_id` | No safe mapping. `ShopLevel` is not the Odoo plan-level type. | Unsupported |
| `pros` / `cons` text | `Pros[]` / `Cons[]` many-to-many relations, each with required `guard` | Supported only as pre-existing `prosIds` / `consIds`; free text cannot be created safely |
| `is_video_group` | `MemberPlan.isVideoGroup` | Supported as `isVideoGroup` |
| `image` | Nullable `MemberPlan.image` string | Read/write omitted: no approved upload, authorization, or signed-media policy |

The safe DTO exposes plan fields, MemberType, PlanDuration, and related Pros/Cons IDs and names only. It does not expose raw image URLs, storage keys, or audit users.

## Historical-data policy

`MemberPlan` is referenced by MemberRequest, Payment, Workout, Conversation, and Channel. A plan with any of those references cannot be updated or deleted (`409 PLAN_IN_USE`). This avoids retroactively changing or removing plan/purchase/mobile-content meaning. Unreferenced plans can be updated or deleted.

The confirmed permissions are `member-plan:list`, `member-plan:read`, `member-plan:create`, `member-plan:update`, and `member-plan:delete` in the reference permission catalog and Admin route.

The current React page cannot be switched to this API unchanged: it sends Odoo `data_type`, `level_id`, free-text pros/cons, and multipart image data. A future approved frontend adapter must use the supported ID-based contract and separately resolve the Plan Level/product decision.
