# Attendance Stage 3A isolated foundation review

Status: validated only in the Admin project’s protected local integration database (`127.0.0.1:55432/yc_fitness_admin_integration`). These files are provisional and were not copied to the mobile reference or any shared environment.

## Local changes validated

### Schema and migrations

The local `prisma/schema.prisma` now proposes:

- `Attendance.source AttendanceSource @default(LEGACY)` with `LEGACY`, `QR`, and `MANUAL`.
- `AttendanceQrCredential` with encrypted payload bytes, IV, AES-GCM authentication tag, HMAC fingerprint, status (`ACTIVE`, `REPLACED`, `REVOKED`), and User audit relations.
- Corresponding explicit `User` relations for credential create/replace/revoke audit actors.

The provisional forward-only migration sequence is:

1. `20261031000000_add_shared_attendance_foundation` — adds sources, credentials, one-active partial unique index, rolling-window trigger, and local-only test-clock gate.
2. `20261031000100_fix_attendance_trigger_audit_timestamp` — fixes direct SQL/shared writers by assigning required `updatedAt`.
3. `20261031000200_fix_attendance_trigger_utc_storage` — fixes the inherited Prisma `timestamp without time zone` representation by storing UTC-naive values explicitly and converting from UTC before deriving the Yangon display date.

All three were applied only through the explicitly localhost-only integration `DATABASE_URL`. They are intentionally not authoritative shared migrations. Before shared adoption, the mobile backend owner must re-author or squash the reviewed SQL into an authoritative migration after a clean migration review; do not copy these local migration folders blindly.

### Rolling-window enforcement

The local trigger:

- serializes by exact advisory lock pair `(807421, memberId)` using `pg_advisory_xact_lock(int, int)`;
- assigns `createdAt` from `clock_timestamp() AT TIME ZONE 'UTC'` after acquiring that lock;
- assigns `updatedAt` equal to `createdAt` to satisfy the existing non-null audit field for direct/shared SQL writers;
- derives legacy `Attendance.date` as `YYYY-MM-DD` in `Asia/Yangon` from the stored UTC instant;
- rejects a same-Member event only inside strict rolling bounds (`>` and `<`), so exactly 60 minutes is allowed;
- raises the deterministic tuple `P0001`, constraint `attendance_rolling_60m`, message `ATTENDANCE_RECENTLY_RECORDED`.

The fixed-clock test hook reads `yc.attendance_test_clock` only when `current_database() = 'yc_fitness_admin_integration`. It cannot be used on a production/staging database with another name. It exists solely to prove millisecond boundary behavior; it must be removed or separately guarded in the authoritative migration after the shared testing strategy is agreed.

### Credential persistence

`AttendanceQrCredentialService` is persistence-only: no HTTP endpoint or Admin route calls it in Stage 3A. It uses local test keys supplied by integration tests, AES-256-GCM encrypted payload bytes, HMAC-SHA-256 fingerprints, and timing-safe verification. It does not log payloads or include raw payloads in test output.

The one-active partial unique index and transactional replace/revoke behavior were validated. Payload retrieval by a new service instance using the same keys proves persistent encrypted storage across process/service instances. This is not production key management: production needs an approved KMS/secret-manager integration.

## Isolated test evidence

`src/modules/attendance/attendance-foundation.integration.test.ts` proves:

- a record 59 minutes, 59.999 seconds after another is rejected;
- exactly 60 minutes is accepted;
- database-derived Yangon date is correct for a UTC midnight crossing;
- simultaneous QR/MANUAL inserts for one Member yield one success and one conflict;
- old close `LEGACY` pairs remain readable and are not deleted;
- encrypted credential create/retrieve/verify/replace/revoke works across service instances;
- concurrent credential creation leaves exactly one active credential.

`src/modules/attendance/attendance.integration.test.ts` was updated to seed deterministic timestamp data through the local-only fixed-clock hook, since the database trigger now correctly owns event timestamps.

## Not implemented in Stage 3A

- No `POST /api/admin/v1/attendance/manual` route.
- No QR credential HTTP management endpoint or public QR endpoint.
- No mobile backend source or Flutter modification.
- No source display in existing Admin attendance list DTO.
- No production/staging connection, migration, deployment, commit, or push.

## Required shared mobile-backend approval and implementation

1. Review/squash the provisional SQL and decide whether the local fixed-clock gate is omitted from production SQL in favor of a separate test-only helper.
2. Add the verified source enum/model/relations to the authoritative mobile schema and migration history.
3. Deploy the trigger and reserve advisory namespace `807421` (or approve another globally documented namespace).
4. Update QR service to validate one encrypted persistent credential, set `source: QR`, omit raw stored QR token for new records, and map the trigger conflict.
5. Provision KMS/secret-manager material for encrypted payloads and HMAC fingerprints; define key rotation and break-glass/reprint procedures.
6. Add/provision distinct QR-management permissions; no existing Admin role receives them automatically.
7. Update Admin Manual Attendance only after the shared migration and mobile writer are deployed and cross-writer integration tests run against the same schema.
8. Decide raw historical `Attendance.qrToken` retention and installed Flutter response compatibility before removing it from any response.
