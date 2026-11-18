# Membership Request compatibility

## Confirmed schema and relations

The shared `MemberRequest` model (`prisma/schema.prisma:208-245`) requires a `Member`, `MemberType`, and `MemberPlan`. Its only canonical lifecycle statuses are `PENDING`, `APPROVED`, and `REJECTED` (`prisma/schema.prisma:380-384`). It records `createdAt`, `approvedAt`, `rejectedAt`, and optional `rejectedReason`.

`Payment.memberRequestId` is optional and a request can have zero or more payments (`schema.prisma:980-981`; `MemberRequest.payments` at line 244). Payment stores an opaque `attachment` string, not a verified public proof URL. The DTO exposes proof availability/status, an authenticated Admin proof path only for the exact supported current format, payment ID/status/amount/request date, structural match, and a non-credential destination summary. It does not return attachment values, object-storage origins/keys, bank account details, Member passwords, MemberProfile storage keys, certificates, photos, or profile URLs.

## Odoo/frontend mapping

| Odoo/frontend field | Verified data | Stage 1 behavior |
| --- | --- | --- |
| `member_name` | `Member.name` | Supported as `memberName` and read-only alias `member_name`. |
| `member_plan_id` | `MemberRequest.memberPlanId` | Supported as `memberPlanId` and alias `member_plan_id`. |
| `request_date` | `MemberRequest.createdAt` | Supported as canonical `date`; Asia/Yangon calendar boundaries are converted to UTC `[midnight, next midnight)`, matching the established Feedback reporting convention. |
| `status: draft` | No matching enum | Rejected with 422; do not equate with `PENDING` silently. |
| `status: paid` | No matching enum | Rejected with 422; it is ambiguous whether this meant payment or approval. |
| `status: rejected` | `REJECTED` | Not aliased; clients must use the canonical enum. |
| `price` | `MemberPlan.price` | Exposed as `memberPlan.currentPrice`, not a historical purchase-price snapshot. |
| `duration_id` | optional `MemberPlan.planDuration` | Returned as a nested duration when populated; `durationMonths` is the plan's scalar value. |
| `confirm_date` | `approvedAt` | Returned as `approvedAt`. |
| `expire_date` | No request expiry field | Unsupported. `MemberPlan.expiredAt` is a plan field and cannot safely be presented as a per-request entitlement expiry. |
| `photo_url` | `Payment.attachment` opaque string | The raw value is unsupported and never returned. Exact current-format proofs receive an authenticated Admin proof path; legacy/local/ambiguous values remain unsupported. |
| request number (`name`) | `MemberRequest.name` nullable | Returned as nullable `requestName`; no synthetic reference is generated. |

The reference Admin routes use confirmed `member-request:list`, `member-request:read`, and `member-request:update` permissions (`routes/admin/v1/member-request.route.ts:14-52`; `prisma/seeds/permission.seeder.ts:83-96`). This API uses list/read for discovery and `member-request:update` for the explicit approve/reject endpoints.

## Known reference approval defects — do not reuse

The old reference update service is not a Stage 2 implementation. It hard-codes `memberTypeId: 2` on approval, performs request and member updates outside a transaction, has no row/version concurrency control, and returns a Member through `MemberService.findOne` rather than the updated request (`app/services/admin/v1/member-request.service.ts:82-148`). It does not establish payment acceptance, entitlement, expiry, audit, or idempotency semantics.

## Proof-media compatibility

The proof endpoint is disabled by default. When enabled, it recognizes only the exact
approved UAT DigitalOcean Spaces attachment format and derives a fixed trusted HTTPS
target without fetching the stored value. Access requires `member-request:read` and
validates the exact request/payment/member/plan/type relationship before fetching.
The response is a metadata-stripped, normalized WebP with private no-store headers.

Existing Mobile-local URLs, historical values, and all other formats remain
unsupported and are never fetched. Raw values, redirects, arbitrary origins, local
paths, and storage keys are prohibited. Supporting additional formats still requires
a separately approved canonical storage contract; it must not be implemented by
relaxing the classifier or proxying arbitrary attachment values.

The approved decision state machine is implemented transactionally and documented in `member-request-approval-contract.md`. The existing schema still has no verified per-Member entitlement, request expiry, renewal history, or historical price snapshot, so the decision flow does not invent them.
