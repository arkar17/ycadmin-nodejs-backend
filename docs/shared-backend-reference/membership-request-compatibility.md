# Membership Request compatibility — Phase 3F Stage 1

## Confirmed schema and relations

The shared `MemberRequest` model (`prisma/schema.prisma:208-245`) requires a `Member`, `MemberType`, and `MemberPlan`. Its only canonical lifecycle statuses are `PENDING`, `APPROVED`, and `REJECTED` (`prisma/schema.prisma:380-384`). It records `createdAt`, `approvedAt`, `rejectedAt`, and optional `rejectedReason`.

`Payment.memberRequestId` is optional and a request can have zero or more payments (`schema.prisma:980-981`; `MemberRequest.payments` at line 244). Payment stores an opaque `attachment` string, not a verified public proof URL. The Stage 1 DTO exposes only proof availability plus payment ID/status/amount/request date. It does not return attachment values, bank account details, Member passwords, MemberProfile storage keys, certificates, photos, or profile URLs.

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
| `photo_url` | `Payment.attachment` opaque string | Unsupported. No URL/key is returned. |
| request number (`name`) | `MemberRequest.name` nullable | Returned as nullable `requestName`; no synthetic reference is generated. |

The reference Admin routes use confirmed `member-request:list`, `member-request:read`, and `member-request:update` permissions (`routes/admin/v1/member-request.route.ts:14-52`; `prisma/seeds/permission.seeder.ts:83-96`). Stage 1 enforces only the verified list/read permissions.

## Known reference approval defects — do not reuse

The old reference update service is not a Stage 2 implementation. It hard-codes `memberTypeId: 2` on approval, performs request and member updates outside a transaction, has no row/version concurrency control, and returns a Member through `MemberService.findOne` rather than the updated request (`app/services/admin/v1/member-request.service.ts:82-148`). It does not establish payment acceptance, entitlement, expiry, audit, or idempotency semantics.

## Proof-media and Stage 2 prerequisites

No proof image is served in Stage 1. The approved future storage approach remains private DigitalOcean Spaces objects with short-lived signed URLs issued only after `member-request:read` (or a more specific owner-approved proof permission) is checked. A public payment-proof URL is not authorized.

Before approval/rejection is implemented, product and shared-backend owners must define: the complete request/payment state machine; whether approval requires an accepted payment; entitlement/member-type/plan/expiry side effects; how plan price/duration are snapshotted; rejection/retry policy; authorized approval roles; and transaction, idempotency, audit, and concurrency requirements. The existing schema has no verified request expiry or historical price snapshot.
