# Attendance implementation plan: shared QR and manual check-ins

Status: implementation-ready plan; no application, migration, schema, or environment change is made by this document.

This plan implements the approved design in [`shared-attendance-contract.md`](./shared-attendance-contract.md): one gym, one permanent printable QR, a rolling 60-minute cross-client interval, exact 60-minute boundary allowed, UTC database event time, Yangon display only, and explicit `QR`, `MANUAL`, and `LEGACY` origins.

## 1. Final invariants

1. The database, not either client clock, assigns every new attendance event time.
2. A new record conflicts when the same Member has an event strictly inside the open interval `(eventTime - 60 minutes, eventTime + 60 minutes)`. Therefore an existing event exactly 60 minutes before the new event is allowed.
3. The constraint applies equally to `LEGACY`, `QR`, and `MANUAL` historical/current rows. Existing rows are never deleted or rewritten merely to resolve historical close pairs.
4. `Attendance.date` remains a compatibility display column. The database derives it from the authoritative UTC timestamp in `Asia/Yangon` as `YYYY-MM-DD`; neither Admin nor Flutter supplies it as a business input.
5. QR and manual writes do not evaluate membership plans, payments, MemberRequests, or entitlement state. They require only an existing active `Member`.
6. A raw QR payload is never logged, emitted in routine list responses, stored in browser/server logs, or embedded in an exception.

## 2. Shared database migration

The shared/mobile backend owns this migration because both the mobile and Admin API write the same table. It must be copied into the Admin workspace only after the shared migration is finalized; the Admin project does not originate or apply it against a shared database.

### 2.1 Prisma schema changes in the shared backend

Affected file: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma`

```prisma
enum AttendanceSource {
  LEGACY
  QR
  MANUAL
}

model Attendance {
  // existing fields
  source AttendanceSource @default(LEGACY)
}

enum AttendanceQrCredentialStatus {
  ACTIVE
  REVOKED
}

model AttendanceQrCredential {
  id                Int                          @id @default(autoincrement())
  status            AttendanceQrCredentialStatus @default(ACTIVE)
  payloadCiphertext Bytes
  payloadIv         Bytes
  payloadAuthTag    Bytes
  payloadFingerprint Bytes                         @unique
  createdById       Int
  replacedById      Int?
  revokedById       Int?
  createdAt         DateTime                     @default(now())
  replacedAt        DateTime?
  revokedAt         DateTime?
  // User relations must be named explicitly to avoid ambiguity.
}
```

The exact User relation field names should follow the project’s existing explicit audit-relation naming convention. Add a partial unique database index—not representable as a normal Prisma `@unique`—that permits at most one `ACTIVE` credential:

```sql
CREATE UNIQUE INDEX "AttendanceQrCredential_one_active_key"
ON "AttendanceQrCredential" ((1))
WHERE status = 'ACTIVE';
```

This supports replacement history and prevents a race from creating two active permanent codes. If product instead requires exactly one singleton record with no historical credential rows, use an `id = 1` check and immutable payload history elsewhere; the recommended historical model is safer for revocation audit.

### 2.2 Source migration and LEGACY backfill

Affected migration (new, shared-backend owned):

1. Create PostgreSQL `AttendanceSource` enum with `LEGACY`, `QR`, `MANUAL`.
2. Add `Attendance.source` as nullable temporarily.
3. Set all existing rows to `LEGACY` in one deterministic update. Do **not** infer `QR` from a non-null `qrToken` or `MANUAL` from `createdById`; both inferences can be wrong for historical/partial data.
4. Set default `LEGACY` and make the column `NOT NULL`.
5. Regenerate Prisma Client in the shared backend and then copy the verified schema/client setup to the Admin workspace.

Old installed Flutter builds that write no `source` remain compatible during rollout because their rows receive `LEGACY`. Updated mobile writes set `QR`; the new Admin route sets `MANUAL`.

### 2.3 Authoritative timestamp, date derivation, and rolling conflict trigger

Affected migration: add a PostgreSQL trigger function on `Attendance` before insert.

The function must:

```sql
-- Constants are illustrative; reserve and document this advisory-lock namespace.
PERFORM pg_advisory_xact_lock(807421, NEW."memberId");

-- Never accept a client-supplied event time for a new check-in.
NEW."createdAt" := clock_timestamp();
NEW.date := to_char(NEW."createdAt" AT TIME ZONE 'Asia/Yangon', 'YYYY-MM-DD');

IF EXISTS (
  SELECT 1
  FROM "Attendance" existing
  WHERE existing."memberId" = NEW."memberId"
    AND existing."createdAt" > NEW."createdAt" - interval '60 minutes'
    AND existing."createdAt" < NEW."createdAt" + interval '60 minutes'
) THEN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    CONSTRAINT = 'attendance_rolling_60m',
    MESSAGE = 'ATTENDANCE_RECENTLY_RECORDED';
END IF;
```

`clock_timestamp()` is required rather than PostgreSQL `now()` because `now()` is transaction-start time. The trigger assigns the timestamp after acquiring the transaction-scoped lock, making it the one authoritative database event time. It also eliminates divergent Admin/mobile Yangon-date formatting. Existing rows retain their historical `createdAt`/`date`; the trigger applies only to future inserts.

`pg_advisory_xact_lock(int, int)` uses the exact pair `(807421, memberId)`. `memberId` is the existing positive `Int` primary key, and `807421` is a documented attendance-only namespace. The two-int lock space prevents collisions with another advisory-lock domain unless that exact namespace/pair is deliberately reused. The lock automatically releases at transaction completion.

The strict `>` comparison means a prior row exactly `60 minutes` earlier does not conflict. The forward condition protects against unusual clock/order anomalies and backdated direct writers; normal trigger-assigned timestamps only need the prior condition. The index `Attendance(memberId, createdAt)` already exists and supports the lookup.

Map database conflict only when both the known constraint name and message are present: `{ SQLSTATE: 'P0001', constraint: 'attendance_rolling_60m', message: 'ATTENDANCE_RECENTLY_RECORDED' }`. The mobile and Admin services convert it to HTTP/application conflict `409 ATTENDANCE_RECENTLY_RECORDED`; all other database failures stay generic. Do not parse a free-form error message alone.

### 2.4 Conflicting legacy rows

Before migration, run read-only SQL in an isolated restored copy to count existing Member event pairs closer than 60 minutes. Record the count and sample only non-sensitive IDs/timestamps for owner review. Do not delete, merge, relabel, or block reads of historical conflicts. The trigger blocks only a future insert that conflicts with an existing legacy record in the active 60-minute window.

## 3. Permanent printable QR credential

### Storage design

The printable payload must be retrievable exactly after restart; a hash-only design cannot meet this requirement. Store one opaque high-entropy payload using envelope encryption:

- Generate at least 256 bits from a cryptographically secure RNG and encode with URL-safe base64/base64url.
- Store the payload encrypted at rest in `AttendanceQrCredential.payloadCiphertext`, with IV and authentication tag stored separately.
- Store `payloadFingerprint = HMAC-SHA-256(qrPayload, ATTENDANCE_QR_HMAC_KEY)` for constant-time, indexed lookup/validation. The HMAC key is a secret, not a database field.
- Keep the data-encryption key outside PostgreSQL in a KMS/secret manager. Production app processes receive only narrowly scoped decrypt/sign capability; local integration uses a disposable local secret.
- Verify an incoming QR by calculating its fingerprint and selecting the active credential. After a fingerprint match, use `timingSafeEqual` against a decrypted value or verify authenticated encryption/plaintext safely. Never use normal string equality for secret material.

The QR payload is not a general API credential: Member JWT authentication and self-only Member ID validation remain mandatory. It is a gym-presence factor. The payload response must have `Cache-Control: no-store`, no telemetry capture, no error echo, and audit events that record credential ID/action but never payload/fingerprint/ciphertext.

### Credential management endpoints and authorization

New Admin QR-management permissions require explicit shared catalog provisioning; do not reuse `attendance:create` because check-in creation and secret disclosure are different capabilities.

| Endpoint | Permission | Contract |
| --- | --- | --- |
| `POST /api/admin/v1/attendance/qr` | proposed `attendance-qr:create` | Creates the first active credential only; returns printable payload once. `409` if active credential exists. |
| `GET /api/admin/v1/attendance/qr` | proposed `attendance-qr:read` | Retrieves current printable payload by decrypting active credential; returns no history. Must be intentionally privileged/audited. |
| `POST /api/admin/v1/attendance/qr/replace` | proposed `attendance-qr:replace` | Generates a new payload transactionally, marks current active credential replaced/revoked, returns new payload once. No automatic rotation. |
| `POST /api/admin/v1/attendance/qr/revoke` | proposed `attendance-qr:revoke` | Revokes active credential and returns no payload. QR check-in fails until a new credential is created. |

All operations require active Admin JWT + database-backed permission and write User audit IDs. Generate a QR image only transiently from the returned payload in a trusted Admin UI/process; do not store a public image object. Printing/reprinting uses `GET` and must be auditable. Product/security must approve whether `read` and `replace` require separation of duties.

## 4. Mobile backend changes

Affected reference files:

- `prisma/schema.prisma`
- new shared migration under `prisma/migrations/<timestamp>_attendance_shared_contract/migration.sql`
- `app/services/member/v1/fitness/attendance.service.ts`
- `app/schemas/member/v1/fitness/attendance.schema.ts` (keep body contract; only improve token bounds/messages if approved)
- `app/controllers/member/v1/fitness/attendance.controller.ts` (error mapping if controller-level mapping is needed)
- `app/resources/member/v1/fitness/attendance.resource.ts` (remove raw `qr_token` from responses)
- `routes/member/v1/fitness/yc-attendance.route.ts` (path unchanged)
- new/updated credential service/controller/routes plus permission seed catalog for QR management
- mobile backend tests for attendance and QR credential service

### QR check-in compatibility

Keep the installed Flutter request body and path unchanged:

```http
POST /member/v1/attendance/create
Authorization: Bearer <member JWT>
{ "partner_id": 123, "qr_token": "same-permanent-printable-payload" }
```

Required service order:

1. Validate body shape and enforce `partner_id === authenticatedMember.id`.
2. Load active Member; reject inactive/nonexistent Member.
3. Verify active permanent QR credential without logging its value.
4. Insert `Attendance` with `memberId`, `source: QR`, `qrToken: null` for new records, no `createdById`, and no caller-supplied `date`/`createdAt`.
5. Let trigger set UTC timestamp/Yangon display date and enforce rolling window.
6. Translate known trigger conflict to the existing JSON-RPC failure shape, retaining a stable machine-readable `ATTENDANCE_RECENTLY_RECORDED` code where the mobile API contract permits it.

Existing installed Flutter applications continue to work because their body/path are unchanged. They will begin receiving a normal failure response for invalid/old QR content after the server update. Flutter should be updated to display the retry time for conflicts and an “ask staff to scan/reprint QR” message for invalid/revoked QR, but server compatibility does not require an immediate app release.

## 5. Admin API changes

Affected Admin files after shared migration/schema synchronization:

- `prisma/schema.prisma` and copied migration history only after verified shared owner release
- `src/modules/attendance/attendance.schema.ts`
- `src/modules/attendance/attendance.repository.ts`
- `src/modules/attendance/attendance.service.ts`
- `src/modules/attendance/attendance.controller.ts`
- `src/modules/attendance/attendance.router.ts`
- `src/routes/admin-v1.ts`
- `src/modules/attendance/attendance.router.test.ts`
- `src/modules/attendance/attendance.integration.test.ts`
- new manual-attendance service/repository tests if separated from list concerns
- `docs/shared-backend-reference/attendance-compatibility.md` and README

### Manual API

```http
POST /api/admin/v1/attendance/manual
Authorization: Bearer <Admin JWT { id, loginType: "admin" }>
Content-Type: application/json

{ "memberId": 123 }
```

Zod body: strict object with positive integer `memberId` only. Reject `qrToken`, `source`, `date`, client timestamps, plan/payment identifiers, and unknown properties with `422`.

Repository/service steps:

1. Existing middleware verifies Admin token, rehydrates active User roles/permissions, and requires `attendance:create`.
2. Read Member by canonical ID and `Status.ACTIVE`; no plan/payment lookup.
3. Insert only `{ memberId, source: MANUAL, createdById: request.auth.userId }`. Do not set `qrToken`, `date`, or `createdAt`.
4. Handle the known trigger conflict deterministically as `409 ATTENDANCE_RECENTLY_RECORDED`. Optional error details may include server-computed `availableAt` only if the database function returns it safely and no attendance details leak.
5. Return `201` with `{ data: { id, checkedInAt, recordedDate, source: "MANUAL", member: { id, name, clientCode } } }`.

Register this route only after the migration is applied to the isolated test database and all mock/integration tests pass. The existing list endpoint remains read-only and must continue omitting QR secrets. It may expose source only after source-field review confirms that doing so is needed and allowed.

## 6. Test plan

### Database trigger tests (shared backend)

1. Insert QR at `t`, manual at `t + 59:59.999`: known trigger conflict.
2. Insert manual at `t`, QR at `t + 59:59.999`: known trigger conflict.
3. Insert either source at exactly `t + 60:00.000`: succeeds.
4. Two concurrent transactions for same Member, one QR and one manual: exactly one succeeds; one has constraint `attendance_rolling_60m`.
5. Concurrent inserts for different Members: both succeed without serialization contention beyond their own locks.
6. Existing `LEGACY` event inside window blocks a new event; historical close legacy pairs remain readable.
7. Trigger overwrites caller-supplied `createdAt`/`date` in a direct SQL test, if direct writes are in scope; otherwise restrict table write privileges and document trusted writer model.
8. Yangon midnight crossing: rolling interval remains UTC 60 minutes while `date` is assigned to the Yangon calendar date.

### Mobile tests

1. Existing installed request payload succeeds with valid permanent QR and active self Member.
2. Empty, invalid, revoked, and replaced QR payloads fail without secret echo.
3. `partner_id` other than authenticated Member fails.
4. Inactive Member fails.
5. Source is `QR`, `createdById` is null, `qrToken` is null on newly created rows.
6. Rolling conflict becomes stable JSON-RPC failure; exact 60-minute boundary succeeds.
7. Member attendance history response never returns a raw QR token.

### Admin tests

1. Missing/expired/wrong-login-type token, inactive User, and revoked `attendance:create` fail 401/403.
2. Unknown, inactive, zero, negative, non-integer Member IDs fail under approved 404/422 policy.
3. Strict body rejects QR and client event-time fields.
4. Manual create writes `MANUAL`, authenticated `createdById`, database-assigned timestamp/date, and no QR token.
5. QR-then-manual and manual-then-QR concurrent integration tests yield one success/one 409.
6. Exact 60-minute boundary succeeds; 59:59.999 fails.
7. DTO excludes QR payload, historical raw token, passwords, profile storage keys, payment/plan claims, and other Member PII.

### Credential-management tests

1. Only one active credential can be created concurrently.
2. Payload retrieved after process restart decrypts to exactly the original printable value.
3. Fingerprint collision/mismatch cannot authenticate; timing-safe comparison is used.
4. Replace revokes prior credential atomically; old printed QR immediately fails.
5. Revoke leaves no active credential; QR checks fail safely; manual check-in remains unaffected.
6. All create/read/replace/revoke permissions are enforced and payload never appears in logs/errors/audit values.

## 7. Deployment order and rollback

1. **Approval gate:** approve migration SQL, trigger function, source/audit relation names, credential permissions, KMS/secret-manager approach, and Member inactive response semantics.
2. **Isolated rehearsal:** restore only synthetic/schema-compatible data; apply migration; run trigger concurrency tests and inspect existing-close-pair report.
3. **Shared migration deployment:** deploy source/credential tables, default `LEGACY`, trigger, indexes, and function before Admin manual route is exposed. Existing clients remain write-compatible because source defaults and trigger derives date/time.
4. **Mobile backend deployment:** update QR verification and source writes while preserving current Flutter body/path and JSON-RPC compatibility. Remove raw token from read responses only after evaluating client reliance; if necessary version the response or make the removal a separately communicated security fix.
5. **Credential bootstrap:** authorized operator creates permanent QR once, prints it, verifies QR check-in with a test Member, and stores no raw payload in tickets/chat/logs.
6. **Admin deployment:** synchronize verified Prisma schema/client, migrate isolated Admin test database, pass tests, then enable `POST /attendance/manual`.
7. **Monitoring:** monitor known rolling conflicts, invalid QR attempts, trigger error rate, lock waits, source distribution, and credential management audit events without token values.

### Rollback

- Disable the Admin manual route first if a problem affects check-ins.
- Keep migration/source/audit data in place; do not destructively drop source columns, credentials, or trigger history during incident response.
- For QR verification defects, server can temporarily reject QR check-ins safely or restore the prior verifier only with explicit security owner approval. Restoring “any non-empty QR token” is a deliberate security regression.
- Schema trigger rollback requires explicit risk acceptance because removing it reintroduces cross-client race/duplicate behavior. Maintain migration forward fixes rather than automatic down migrations on shared production data.

## 8. Decisions still requiring approval

1. Exact database migration SQL, especially trigger ownership/security-definer posture, table-write privileges, and constraint error fields.
2. KMS/secret manager provider, service identity permissions, local-development secret handling, and encryption/HMAC key rotation procedure.
3. New QR-management permission names and which Admin roles receive them; confirm separation of `read` versus `replace`/`revoke` duties.
4. Whether `GET /attendance/qr` returns raw printable payload to browser users or requires a server-side printable artifact workflow; both reveal the same payload but have different audit/exposure risks.
5. Missing/inactive Member error semantics for Admin manual attendance.
6. Whether `Attendance.qrToken` must be retained for historical forensic needs or removed/nullified in a later, separately approved migration.
7. Response-versioning plan if currently installed Flutter builds depend on receiving raw `qr_token` in attendance history.
