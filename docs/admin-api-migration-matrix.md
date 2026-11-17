# Admin API Migration Matrix — Phase 3P

Status meanings: **READY** = complete safe Node contract for the operation with only
normal adapter/RBAC rollout work; **PARTIAL** = Node/local equivalent exists but one or
more material migration dependencies remain; **BLOCKED** = an essential operation lacks
a safe model/business rule/media contract. Odoo routes are JSON-RPC paths used by the
current frontend, not proposed Node paths.

| # | Frontend screen / operation | Existing Odoo/client operation | Node endpoint / status / permission | Field gap and required changes | Dependency class | Readiness |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Login | `POST /admin/login` | `POST /auth/login` registered; no permission | Replace cookie/localStorage Odoo login with Node in-memory JWT production flow; preserve coexistence plan. | Auth/session, deployment | PARTIAL |
| 2 | Logout | `POST /admin/logout` | No server logout; local Node logout clears memory token | Define Node session/revocation policy or retain stateless logout semantics; primary layout is Odoo-only. | Auth/session | PARTIAL |
| 3 | Users list/search/pagination | `POST /members/list` | `GET /members`, `member:list` | Node has name/contact search; current `member_plan_id` filter returns `422` because no current-plan relation. Adapt DTO and remove/replace plan filter. | Frontend + missing entitlement relation | PARTIAL |
| 4 | Member requests list/filter | `POST /member_request/list` | `GET /membership-requests`, `member-request:list` | Canonical `PENDING/APPROVED/REJECTED`, no Odoo `paid`; no price/duration/proof/expiry snapshots. | Frontend + business rules | PARTIAL |
| 5 | Member request detail | `POST /member_request/:id/detail` | `GET /membership-requests/:id`, `member-request:read` | No public proof URL, confirmation, or per-request expiry; map safe DTO. | Media + entitlement | PARTIAL |
| 6 | Approve request | `POST /member_request/:id/approve` | Deferred; `member-request:update` exists but no safe Node route | Needs payment prerequisite, entitlement activation/expiry, audit/idempotency/concurrency contract. | Shared business rule/schema/mobile | BLOCKED |
| 7 | Reject request | `POST /member_request/:id/reject` | Deferred | Needs rejection reason/payment/retry/refund policy and terminal transition contract. | Shared business rule/mobile | BLOCKED |
| 8 | Member plans list | `POST /member_plan/list` | `GET /member-plans`, `member-plan:list` | Frontend `data_type` differs from `memberTypeId`; `level_id` unsupported. | Frontend + plan-level decision | PARTIAL |
| 9 | Member plan detail | `POST /member_plan/:id/detail` | `GET /member-plans/:id`, `member-plan:read` | Image omitted; Odoo plan-level/data type fields cannot be fabricated. | Media + plan-level decision | PARTIAL |
| 10 | Member plan create | Multipart `/member_plan/create` | `POST /member-plans`, `member-plan:create` | Use IDs for MemberType/Duration/Pros/Cons; cannot send free text/image/Odoo type/level. | Frontend + media + plan-level | PARTIAL |
| 11 | Member plan update | Multipart `/member_plan/:id/update` | `PATCH /member-plans/:id`, `member-plan:update` | Same DTO change; referenced plans are protected from unsafe historical changes. | Frontend + history/media | PARTIAL |
| 12 | Member plan delete | `/member_plan/:id/delete` | `DELETE /member-plans/:id`, `member-plan:delete` | Node blocks dependent request/payment/workout/conversation/channel records. Handle `409 PLAN_IN_USE`. | Frontend + mobile references | PARTIAL |
| 13 | Plan Duration list | `/plan_duration/list` | `GET /plan-durations`, proposed `plan-duration:list` | Fields map directly (`name`, `value`); replace JSON-RPC adapter. | Permission provisioning + frontend | READY |
| 14 | Plan Duration create | `/plan_duration/create` | `POST /plan-durations`, proposed `plan-duration:create` | JSON REST body; handle duplicate value conflict. | Permission provisioning + frontend | READY |
| 15 | Plan Duration update | `/plan_duration/:id/update` | `PATCH /plan-durations/:id`, proposed `plan-duration:update` | Handle `409 DURATION_IN_USE` for referenced durations. | Permission provisioning + frontend | READY |
| 16 | Plan Duration delete | `/plan_duration/:id/delete` | `DELETE /plan-durations/:id`, proposed `plan-duration:delete` | Same reference protection; no soft delete field. | Permission provisioning + frontend | READY |
| 17 | Plan level list | `/plan_level_type/list` | No equivalent endpoint | `level_count` has no Prisma mapping; ShopLevel is not equivalent. | Product/schema decision | BLOCKED |
| 18 | Plan level create | `/plan_level_type/create` | No safe equivalent | Cannot create a missing `level_count` field through ShopLevel or MemberType. | Product/schema decision | BLOCKED |
| 19 | Plan level update | `/plan_level_type/:id/update` | No safe equivalent | Same unmapped semantics and unknown lifecycle. | Product/schema decision | BLOCKED |
| 20 | Plan level delete | `/plan_level_type/:id/delete` | No safe equivalent | Must define model/references/deletion policy first. | Product/schema decision | BLOCKED |
| 21 | Bank list/search | `/bank_information/list` | `GET /bank-information`, `bank-information:list` | List masks account number and omits image; map enum to `BANK_ACCOUNT/E_WALLET`. | Frontend + media | PARTIAL |
| 22 | Bank create | multipart `/bank_information/create` | `POST /bank-information`, `bank-information:create` | JSON camelCase only; no image upload; explicit enum mapping. | Frontend + media | PARTIAL |
| 23 | Bank update | multipart `/bank_information/:id/update` | `PATCH /bank-information/:id`, `bank-information:update` | Fetch protected detail before edit; referenced destinations cannot be changed. | Frontend + media/history | PARTIAL |
| 24 | Bank delete | `/bank_information/:id/delete` | `DELETE /bank-information/:id`, `bank-information:delete` | Node rejects referenced payment destinations. | Frontend + payment references | PARTIAL |
| 25 | Feedback list/filter | `/client_feedback/list` | `GET /feedback`, proposed `feedback:list` | REST field/date/pagination mapping required. | Permission provisioning + frontend | PARTIAL |
| 26 | Feedback detail | `/client_feedback/:id/detail` | `GET /feedback/:id`, proposed `feedback:read` | Safe Member summary only; adapt field names. | Permission provisioning + frontend | PARTIAL |
| 27 | Workout list/filter | `/workout/list` | `GET /workout-videos`, `workout:list` | IDs/status differ from Odoo hard-coded enums; stored media is opaque. | Frontend + reference data/media | PARTIAL |
| 28 | Workout detail | `/workout/:id/detail` | `GET /workout-videos/:id`, `workout:read` | Odoo-only calorie/free-video fields unavailable. | Frontend + schema gap | PARTIAL |
| 29 | Workout create | multipart `/workout/create` | Deferred | Video storage/upload/validation, references, Odoo-only fields, and creation contract unresolved. | Media + reference data/business rules | BLOCKED |
| 30 | Workout update | multipart `/workout/:id/update` | `PATCH /workout-videos/:id`, `workout:update` | Only safe metadata/status subset; no video/relationship/free/calorie changes. | Frontend + media/business rules | PARTIAL |
| 31 | Workout delete | `/workout/:id/delete` | Deferred | Deletion cascades PersonalWorkoutHistory; no approved retention policy. | Historical data/business rule | BLOCKED |
| 32 | Node local login | `POST /api/admin/v1/auth/login` | Registered, public rate-limited login | Local-only page; production route/session strategy not approved. | Auth/session/deployment | PARTIAL |
| 33 | Attendance list/filter | Node `GET /attendance` | Registered `GET /attendance`, `attendance:list` | Local Node page only; no plan mapping; shared attendance migration must be adopted. | Shared migration/mobile + frontend | PARTIAL |
| 34 | Member lookup for manual attendance | Node `GET /members` | Registered `GET /members`, `member:list` | Canonical Member ID works; requires Node session and no plan filter. | Auth/frontend | PARTIAL |
| 35 | Manual attendance | Node `POST /attendance/manual` | Registered; `attendance:create` | Local isolated foundation works; production waits for shared trigger/migration/mobile rollout. | Shared migration/mobile | PARTIAL |
| 36 | QR retrieve/reprint | Node `GET /attendance/qr` | Registered; proposed `attendance-qr:read` | Requires shared catalog provision plus encryption/HMAC secrets and migration adoption. | Permission + secrets + mobile | PARTIAL |
| 37 | QR generate first credential | Node `POST /attendance/qr` | Registered; proposed `attendance-qr:create` | Same; no replace/revoke endpoint. | Permission + secrets + mobile | PARTIAL |
| 38 | Node local logout | Client-side memory-token clear | No server call by design | Keep memory-only behavior; decide production UX/token-expiry handling. | Auth/session/frontend | PARTIAL |
| 39 | QR print/download | Browser action from retrieved payload | No separate backend call | Must remain restricted to QR-read operators; production secret/access policy required. | Permission + security UX | PARTIAL |
| 40 | Dashboard display | Mock `demoData`, component is unrouted | `GET /dashboard/overview`, proposed `dashboard:read` | Create Node REST client/route; remove mocks only after permission provision. Membership/revenue widgets remain unavailable. | Frontend + permission + data rules | PARTIAL |

Additional Node-only reference APIs without an existing dedicated frontend screen are
`GET /member-types` (`member-type:list`) and `GET /shop-plan-levels` / `:id`
(`shop-level:list/read`). They are read-only reference data and cannot replace Odoo
Plan Level Types.
