# Mobile Backend Attendance Integration Package

This is a review package for the read-only reference at `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference`. It is **not** an applied patch, migration, deployment instruction, or permission grant. No reference-backend file was modified while preparing it.

## Confirmed current behavior

| Concern | Confirmed reference evidence | Required integration change |
| --- | --- | --- |
| Route | `routes/member/v1/fitness/yc-attendance.route.ts:18-24` exposes `POST /api/member/v1/attendance/create`. | Keep path and Passport JWT middleware unchanged. |
| Body envelope | `app/controllers/member/v1/fitness/attendance.controller.ts:106-110` validates `req.body.params`. | Keep `{ params: { partner_id, qr_token } }` transport behavior used by installed Flutter builds. |
| Member identity | `attendance.service.ts:22-44` requires `partner_id === req.user.id` and active Member. | Retain unchanged. |
| JWT identity separation | `app/middlewares/passport/jwt-strategy.ts:20-54` treats every non-`admin` claim as a Member. | Require `loginType === "member"` before Member lookup. |
| Token check | `attendance.service.ts:50-52` merely trims a non-empty token. | Verify against the encrypted active permanent credential. |
| Duplicate policy | `attendance.service.ts:54-68` performs a non-atomic `gte` pre-check. | Remove it; the shared database trigger is authoritative. |
| Write | `attendance.service.ts:70-79` writes caller token and app-derived Yangon date. | Write `source: QR`, `qrToken: null`, and let the trigger set UTC timestamp/date. |
| Response | `attendance.service.ts:81-86` returns a JSON-RPC success payload. | Preserve exactly. |
| History leak | `attendance.resource.ts:16-24` returns raw `qr_token`. | Preserve the key but return `null`; confirm Flutter tolerates it before release. |
| Error convention | `attendance.controller.ts:140-159` catches expected errors and returns JSON-RPC `isFullFilled: false` with HTTP 200. | Map the known trigger conflict to the same envelope and existing friendly message. |

The reference contains no automated test files or test script (`package.json`); the test plan therefore identifies a required test harness decision rather than pretending that an existing suite was extended.

## Package contents

- `schema.prisma.patch` — additive Prisma schema patch.
- `migration.sql` — one authoritative, forward-only migration proposal. It consolidates the Admin-local Stage 3A migration and follow-up fixes; do not copy the local migration folders.
- `attendance-qr-credential.service.ts` — new reference-backend service for HMAC lookup/AES-GCM verification only.
- `member-attendance.service.patch` — replacement logic for the existing mobile QR write path.
- `member-attendance.controller.patch` — preserves JSON-RPC failures for expected service errors.
- `member-attendance.resource.patch` — removes raw token disclosure without changing the response key.
- `permission.seeder.patch` — proposed catalog entries only; it assigns nothing to roles.
- `integration-test-plan.md` — required functional, migration, concurrency, and rollout verification.

## File-change manifest for the shared-backend owner

| Action | Reference target | Purpose |
| --- | --- | --- |
| Modify | `prisma/schema.prisma` | Add source enums, credential model, and explicit User audit relations. |
| Add | `prisma/migrations/<owner-approved-timestamp>_shared_attendance_contract/migration.sql` | Single consolidated shared migration. |
| Add | `app/services/member/v1/fitness/attendance-qr-credential.service.ts` | Validate encrypted permanent QR material. |
| Modify | `app/services/member/v1/fitness/attendance.service.ts` | Verify QR, set `QR`, omit raw token, map database conflict. |
| Modify | `app/middlewares/passport/jwt-strategy.ts` | Reject non-`member`/non-`admin` token claim types rather than treating them as a Member. |
| Modify | `app/controllers/member/v1/fitness/attendance.controller.ts` | Continue JSON-RPC expected-error envelope for safe service-unavailable handling. |
| Modify | `app/resources/member/v1/fitness/attendance.resource.ts` | Never disclose historical raw QR values. |
| Modify | `prisma/seeds/permission.seeder.ts` | Define, but do not grant, QR-management permissions. |
| Add | owner-selected test files/harness | Test this cross-writer contract before release. |

No route registration change is needed for mobile QR check-in. No Flutter, admin-reference, media, branch, or automatic rotation code is part of this package.

## Flutter compatibility

Installed Flutter builds keep using:

```http
POST /api/member/v1/attendance/create
Authorization: Bearer <member JWT>
Content-Type: application/json

{ "params": { "partner_id": 123, "qr_token": "permanent-gym-qr-payload" } }
```

The logical payload fields match the requested `{ partner_id, qr_token }` contract, but the verified current controller reads them from `req.body.params`. This wrapper is an important installed-client compatibility fact; the mobile owner should confirm it against a captured non-production request before changing any request parser.

The exact current success envelope remains:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "result": {
    "isFullFilled": true,
    "message": "Success",
    "data": {
      "attendance_id": 1,
      "member_name": "…",
      "client_type": "…",
      "check_in_time": "…"
    }
  }
}
```

Expected failures remain HTTP 200 JSON-RPC `result.isFullFilled: false`, matching the present controller. The new rolling-window conflict uses the existing visible message `Already checked in! Please try again after 1 hour.` rather than changing an installed-client response shape. Server metrics/logs may classify it as `ATTENDANCE_RECENTLY_RECORDED`, but must never include the QR value.

`qr_token` in attendance-history list items is the only compatibility decision left open: this package returns `null` under the existing key. Owner must confirm that a Flutter build does not assume a non-null string; otherwise a versioned response/security transition is required before removal.

## Security and permission checklist

- Supply the same `ATTENDANCE_QR_ENCRYPTION_KEY` (canonical base64, exactly 32 decoded bytes) and `ATTENDANCE_QR_HMAC_KEY` (canonical base64, at least 32 decoded bytes) to both Admin and mobile services from the approved secret manager.
- Do not add keys to source control, Prisma, SQL, browser payloads, logs, analytics, tickets, or service-account files.
- The credential table stores ciphertext, IV, GCM tag, and HMAC fingerprint only; new attendance rows store `qrToken: null`.
- The proposed `attendance-qr:create` and `attendance-qr:read` permissions are catalog entries only. The shared owner must explicitly grant them to approved active Admin roles; no role assignment is in this package.
- Require operational audit events for create/read/reprint actions with actor ID, credential ID, request ID, and action only. Never record cryptographic material.
- No public credential API, QR replacement/revocation route, automatic expiry/rotation, branch field, or client-supplied timestamp is introduced.

## Rollout and rollback

1. Obtain approvals for the migration, timestamp semantics, secret-manager integration, permission grants, and list-response transition.
2. Rehearse on a synthetic/isolated database after checking existing close attendance pairs read-only. Do not delete or relabel historical records.
3. Apply the one shared migration, regenerate Prisma Client, and validate it against the mobile backend at its locked Prisma 7.5 toolchain.
4. Deploy mobile verification code with secrets available, preserving the existing endpoint and body envelope.
5. Create the permanent credential once through the already-protected Admin API, print it through an approved process, and run a synthetic-member smoke test.
6. Deploy/enable Admin manual attendance only after both writers use the shared schema and trigger.
7. Monitor conflict count, invalid QR count, lock waits, and credential failures without payload values.

Rollback application traffic before schema rollback. Do not drop `source`, credential audit rows, or the rolling trigger automatically. Reverting to acceptance of any non-empty QR token is a security regression requiring explicit owner approval.

## Decisions requiring owner approval

1. The migration timestamp/folder name and review of existing production data on a restored, non-production copy.
2. Secret-manager/KMS provider, application identities, rotation procedure, and emergency reprint process.
3. Explicit Admin roles for `attendance-qr:create` and `attendance-qr:read`, including whether reprint needs separation of duties.
4. Whether returning `qr_token: null` is safe for installed Flutter clients or needs response versioning.
5. Whether source exposure in historical Admin/member list DTOs is a product requirement; this package does not add it.
6. Whether a future credential replacement/revocation workflow is needed; it is intentionally not included here.
