# Shared attendance contract: Admin manual and Flutter QR check-ins

Status: proposed architecture contract. This document does not authorize schema, mobile, Admin, or deployment changes.

## Scope and business rules

1. A successful check-in is an `Attendance` record for one Member at one server-recorded UTC instant.
2. A Member may have one successful check-in in each rolling 60-minute interval, irrespective of origin (`MANUAL` or `QR`). The interval is based on UTC instants, not a local calendar day.
3. Exactly 60 minutes after the prior successful check-in is allowed. Formally, a new event at `t` conflicts only with an existing event for that Member whose event timestamp is strictly greater than `t - 60 minutes` and strictly less than `t + 60 minutes`; boundary timestamps at exactly 60 minutes do not conflict.
4. Asia/Yangon is used only for display/reporting and to derive the legacy `Attendance.date` display value. It must not change the rolling interval.
5. Manual check-in requires an active Admin with `attendance:create`, a canonical Member ID, and no QR token. QR check-in retains mobile Member authentication and requires the permanent gym QR token.
6. The only currently evidenced eligibility rule is that the Member exists and has `Member.status = ACTIVE`. Payment, plan, member-request, and entitlement state must not gate attendance until a separate approved contract exists.
7. Single-gym permanent QR is in scope; branch/location selection is not.

## Existing behavior evidence

| Topic | Confirmed behavior | Evidence |
| --- | --- | --- |
| QR request | Flutter/mobile request requires positive `partner_id` and a non-empty `qr_token`; it does not validate token authenticity. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/schemas/member/v1/fitness/attendance.schema.ts:3-11` |
| QR identity | Mobile checks `partner_id === currentMemberId` and looks up an active Member. | `app/services/member/v1/fitness/attendance.service.ts:15-45` |
| Existing duplicate rule | It finds any record with `createdAt >= new Date(Date.now() - 60m)` and rejects. Thus an event exactly equal to the threshold is rejected by the code's inclusive `gte`; no cross-request lock exists. | `app/services/member/v1/fitness/attendance.service.ts:10,48-67` |
| QR write | Mobile writes `memberId`, Yangon-formatted legacy `date`, and submitted `qrToken`; `createdAt` is database/default server time. | `app/services/member/v1/fitness/attendance.service.ts:69-85`; `app/helpers/helper.ts:143-157` |
| Manual reference write | Legacy Admin create writes `memberId`, caller-supplied legacy `date`, and `createdById`; it checks only `(memberId,date)`. | `app/services/admin/v1/attendance.service.ts:154-176` |
| Admin actor relation | `Attendance.createdById` and `updatedById` are nullable foreign keys to `User`, so the authenticated Admin identity is representable as an audit actor. | `prisma/schema.prisma:1015-1020` |
| Token/source fields | `qrToken` is nullable. It does not declare an attendance source, and legacy/failed/manual data cannot durably be classified from nullability. | `prisma/schema.prisma:1008-1023` |
| Database constraint | A shared migration deliberately dropped `Attendance_memberId_date_key`, added nullable `qrToken`, and retained only non-unique index `(memberId,createdAt)`. | `prisma/migrations/20260903120000_attendance_allow_multi_checkin/migration.sql:1-8` |

The current behavior does not satisfy this contract: QR accepts every non-empty token, its boundary is inclusive, and concurrent Admin/Flutter writes can both pass the read-then-insert check.

## Canonical data and audit model

`Attendance.createdAt` is the check-in instant. New writes must let PostgreSQL assign it (or use one centrally captured server timestamp); clients must never supply an event timestamp.

`Attendance.date` remains legacy presentation compatibility only. Both write paths calculate it from the server event instant using `Asia/Yangon` in the existing `YYYY-MM-DD` format. No enforcement must query this string.

`createdById` records the authenticated Admin User for manual check-ins. It remains null for Flutter QR Member-originated events; it is an audit actor, not a sufficient durable source classification.

### Required source distinction

Auditable origin requires a shared schema change. Add a non-null `Attendance.source` enum such as `LEGACY | QR | MANUAL`, defaulting existing rows to `LEGACY`. Both new writers must set `QR` or `MANUAL`. Do not backfill old rows by guessing from `qrToken` or `createdById`.

The raw QR token must not be returned by Admin or Member list APIs. Its continued storage in `Attendance.qrToken` is unnecessary for the proposed permanent-QR design and requires a separate retention decision; no immediate destructive migration is proposed here.

## Concurrency-safe enforcement

An application-only Prisma transaction is insufficient because current Flutter and Admin APIs are separate writers. A shared database migration is necessary to enforce the policy across both clients.

Recommended implementation: a PostgreSQL `BEFORE INSERT` trigger owned by the shared backend schema. It must:

1. Take a transaction-scoped advisory lock keyed by `NEW.memberId` (`pg_advisory_xact_lock` with a documented, collision-safe key convention).
2. Use the database-generated/current event timestamp as the proposed instant.
3. Reject when another row for that Member is strictly within the preceding/following 60-minute interval. Strict comparisons make exactly 60 minutes allowed.
4. Raise a stable database error that both applications map to `409 ATTENDANCE_RECENTLY_RECORDED` with a retry-after/check-in-available timestamp.

The trigger protects concurrent QR/manual inserts even while clients run on different processes. It also protects direct database writers. An alternative PostgreSQL exclusion constraint may be viable, but requires a migration spike to validate extension availability, expression immutability, existing-data compatibility, and error mapping. Do not select it without that spike.

The write services may pre-check for friendly messaging, but that pre-check is advisory only; the trigger is authoritative. Use a transaction around any necessary Member validation plus insert, and handle the trigger conflict deterministically. Do not reintroduce a daily unique key: it would violate the approved rolling-hour direction.

## Endpoint contracts

### Flutter QR check-in (existing path, compatible body)

Continue `POST /member/v1/attendance/create` with the existing body:

```json
{ "partner_id": 123, "qr_token": "printed-gym-qr-value" }
```

Compatibility requirements:

- Preserve Member JWT authentication and self-only `partner_id` validation.
- Preserve request and success response shape where practical.
- Replace non-empty-token acceptance with validation of the configured permanent gym QR value.
- Set `source: QR`; calculate legacy `date` from server time in Yangon; rely on shared enforcement for the rolling-hour conflict.
- Never expose the configured QR secret in logs, errors, or responses.

The permanent printable QR must contain an opaque, high-entropy value. The owner must choose its authoritative storage and rotation procedure (for example, a dedicated hash/configuration owned by the mobile backend). `SystemParameter` has no verified QR contract and must not be repurposed without ownership approval. The printable code remains permanent until an explicitly governed rotation; reprint/compromise procedures are required.

### Admin manual check-in (new REST path)

`POST /api/admin/v1/attendance/manual`

```json
{ "memberId": 123 }
```

- Authenticate `{id, loginType:'admin'}`, hydrate active User/RBAC, and require `attendance:create`.
- Validate only positive canonical Member ID; do not accept a QR token, source string, client timestamp, plan, payment, or `date` value.
- Verify active Member existence; do not infer membership/payment eligibility.
- Set `createdById` to the authenticated User, `source: MANUAL`, legacy Yangon `date`, and server check-in time.
- Return `{id, checkedInAt, recordedDate, source:'MANUAL', member:{id,name,clientCode}}` and no token/secret.
- Map the shared enforcement conflict to `409 ATTENDANCE_RECENTLY_RECORDED`; invalid IDs to 422, missing/inactive Member to 404 (or an owner-approved 409/422 policy), and inactive/revoked Admin to existing 401/403 conventions.

## Schema migration assessment

A schema migration is required before manual attendance can be safely enabled under this contract:

1. `AttendanceSource` enum and non-null `Attendance.source` with safe `LEGACY` default/backfill for existing rows.
2. Database-level rolling-window enforcement (recommended trigger with per-member advisory lock).
3. Migration validation against existing attendance data, including duplicates already less than 60 minutes apart. Existing records must remain readable; enforcement applies to future inserts unless product explicitly authorizes cleanup.

No changes to Member, Plan, Payment, MemberRequest, or QR token tables are required for the minimal attendance contract. QR configuration storage is an independent owner decision, not a reason to change `Attendance` prematurely.

## Implementation responsibilities

| Owner | Responsibility |
| --- | --- |
| Shared/mobile backend owner | Approve and ship schema migration/trigger, source enum, permanent QR verification, Flutter endpoint update, and stable conflict error mapping. |
| Flutter owner | Keep existing request body, handle rolling-window conflict, remove assumptions that an arbitrary non-empty token is accepted, and manage permanent QR UX. |
| Admin API owner | Add protected manual endpoint only after shared migration is deployed to the shared contract; set `createdById` and `MANUAL`; map trigger conflict; add integration tests. |
| Product/security owner | Approve permanent QR generation/storage/rotation/revocation process, error UX, Member inactive policy, and retention/access policy for historical raw `qrToken`. |

## Rollout and rollback

1. Add and test the source/enforcement migration on an isolated clone with synthetic conflict cases.
2. Deploy the migration first in a backward-compatible mode: `source` defaults to `LEGACY`; trigger initially logs/metrics conflicts only if an owner-approved observation period is required.
3. Update mobile QR service and Admin API together to set explicit sources and map the shared conflict.
4. Enable trigger rejection after both writers are confirmed compliant; monitor conflict/error rate and locks.
5. Roll back application routes by disabling manual creation and reverting QR validation behavior only if required. Do not drop audit/source columns or enforcement automatically; schema rollback needs an explicit data-safety plan.

## Test matrix

| Test | Expected result |
| --- | --- |
| QR then manual at 59:59.999 | shared conflict |
| Manual then QR at 59:59.999 | shared conflict |
| Either origin exactly 60:00.000 later | allowed |
| Same Member simultaneous QR/manual requests | exactly one insert; one stable conflict |
| Different Members simultaneous | both allowed |
| QR body missing/invalid token | validation/authorization error; no row |
| QR token valid but Member inactive | no row |
| Manual active Admin + active Member | `MANUAL`, `createdById`, no token |
| Manual revoked/inactive Admin | 403/401, no row |
| No plan/payment/request record | does not affect attendance eligibility |
| Yangon midnight crossing | rolling-window behavior unchanged; reporting/display day changes correctly |
| Existing legacy records | readable as `LEGACY`; no inferred source |
| Admin and Flutter DTOs | never expose QR secret/raw stored token |

## Open approval decisions

1. Approve the source enum names and `LEGACY` handling.
2. Approve trigger/advisory-lock design versus a validated exclusion-constraint alternative.
3. Approve how permanent gym QR material is generated, stored, rotated, revoked, and printed.
4. Approve whether a missing/inactive Member returns 404, 409, or 422 in Admin UX.
5. Approve the future retention/removal strategy for raw historical `Attendance.qrToken` values.
6. Approve whether enforcement begins immediately for all future rows or after an observation period.
