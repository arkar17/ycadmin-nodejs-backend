# Attendance compatibility — Phase 3G Stage 1

## Confirmed model and timestamp

`Attendance` (`prisma/schema.prisma:1008-1023`) contains required `memberId`, legacy `date: String`, optional `qrToken`, audit IDs, `createdAt`, and `updatedAt`. It has a verified index on `[memberId, createdAt]`.

`Attendance.createdAt` is the canonical check-in instant for Admin filtering. Mobile QR creation writes `date` using a formatter and relies on the automatically assigned `createdAt` time (`app/services/member/v1/fitness/attendance.service.ts:48-86`). Its duplicate guard also queries `createdAt` over the preceding hour (lines 54-66). The legacy Admin manual-create code accepts an arbitrary `DD-MM-YYYY` `date` string (`app/schemas/admin/v1/attendance.schema.ts:3-10`), so `date` cannot be used as a reliable timestamp.

The Admin list uses Asia/Yangon calendar ranges against `createdAt`: `dateFrom` becomes local midnight inclusive; `dateTo` becomes the following local midnight exclusive. Ordering is `createdAt DESC, id DESC`.

## Frontend/Odoo compatibility

| Current frontend/Odoo field | Verified source | Stage 1 behavior |
| --- | --- | --- |
| `name` | `Member.name` | Accepted as compatibility alias for `memberName`. |
| `member_code` | `Member.code` | Accepted as alias for `memberCode`. |
| `date_from`, `date_to` | `Attendance.createdAt` | Accepted as aliases for `dateFrom`, `dateTo`; date-only calendar ranges use Asia/Yangon. |
| `date` | `Attendance.date` | Returned as `recordedDate` only; not used for range filtering. |
| `member_id`, `client_code`, `client_type`, `phone` | `Member` relation | Returned in a safe nested `member` DTO. Phone is included only because the existing Attendance page displays it. |
| `member_plan_id` | No direct Attendance relation | Unsupported and omitted. The schema does not identify a current plan for an attendance event. |
| Odoo `partner_id` | No verified mapping | Rejected as an unknown filter; no mapping is invented. |
| QR token | `Attendance.qrToken` | Never returned. |

The existing frontend uses JSON-RPC response names and also offers manual-create and QR actions. Those routes are not compatible with this REST endpoint and no frontend file changed in this phase.

## Permissions and deferred operations

The copied shared permission catalog defines `attendance:list`, `attendance:read`, `attendance:create`, `attendance:update`, and `attendance:delete` (`prisma/seeds/permission.seeder.ts:585-604`). Stage 1 uses only the verified `attendance:list` permission after active-Admin identity hydration.

The isolated Admin environment now has a provisional, tested Manual Attendance route at `POST /api/admin/v1/attendance/manual`. It requires `attendance:create`, accepts only a canonical active Member ID, writes `MANUAL` plus the authenticated Admin audit actor, and relies on the database trigger for UTC time, Yangon display date, and rolling-hour conflict enforcement. It has not been adopted by the shared mobile backend, so production enablement remains blocked on the shared migration/trigger, mobile QR writer update, and approved secret management described in `attendance-stage-3a-review.md`.

## Permanent QR management — Stage 3C

`POST /api/admin/v1/attendance/qr` and `GET /api/admin/v1/attendance/qr` are now registered in the Admin API. They are intentionally distinct from manual check-in and from the existing mobile QR implementation:

- both require an active User-side Admin JWT and current database-backed QR-management permission;
- `POST` requires `attendance-qr:create`, accepts no caller input, and creates a credential only when no active one exists (`409 QR_ALREADY_EXISTS` otherwise);
- `GET` requires `attendance-qr:read` and returns the same encrypted-at-rest credential payload for intentional reprinting; it never rotates the credential (`404 QR_NOT_CONFIGURED` when absent);
- success bodies expose only `credentialId`, `qrPayload`, and `createdAt`, with `Cache-Control: no-store`; no fingerprint, encryption material, database secret fields, or history is exposed;
- key material is process configuration only. Missing/invalid configuration fails closed; there is no generated fallback.

The copied mobile implementation still persists the submitted token and accepts any non-empty value. Stage 3C does not alter that flow. Shared deployment remains blocked on authoritative migration adoption, a mobile QR verifier that uses the encrypted credential/fingerprint, and explicit provisioning of the new permissions. See `attendance-qr-permission-provisioning.md`.
