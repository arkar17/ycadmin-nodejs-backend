# Shared Mobile Attendance Integration Test Plan

The reference backend currently has no test runner or test files. Before accepting the patch, the owner must select and configure a TypeScript-compatible runner (for example Vitest) and a dedicated PostgreSQL integration database. Never point it at production/staging or reuse live records.

## Static review completed

- The proposed Prisma syntax matches the reference’s Prisma 7 schema style: `prisma/schema.prisma:7-15`, `1008-1023`.
- The proposal uses the existing adapter-based client boundary: `prisma/client.ts:1-10`.
- The mobile path and Passport authentication remain unchanged: `routes/member/v1/fitness/yc-attendance.route.ts:8-24`.
- The `req.body.params` envelope and JSON-RPC response format are preserved: `app/controllers/member/v1/fitness/attendance.controller.ts:106-155`.
- The existing reference has no `AttendanceSource`, credential model, QR-management permissions, or test harness; all are deliberately explicit additions.

Static review cannot compile the artifacts in place because the reference is read-only and Prisma Client must be generated only after the authoritative migration/schema are accepted.

## Migration rehearsal

Use a newly created isolated PostgreSQL database populated only with synthetic records.

1. Apply the full existing shared migration history, then the proposed single migration.
2. Run `prisma generate` using the reference lockfile’s Prisma 7.5 version; do not execute `migrate dev`, `db push`, or `migrate reset` against shared data.
3. Assert every pre-existing Attendance row has `source = LEGACY`; do not infer source from `qrToken` or `createdById`.
4. Assert pre-existing close-together rows remain readable and unchanged.
5. Assert the partial unique index permits historical revoked/replaced credentials but permits at most one `ACTIVE` credential.
6. Insert raw SQL rows with caller-supplied `createdAt`, `updatedAt`, and `date`; assert trigger values are database-owned UTC timestamp and Yangon `YYYY-MM-DD` date.
7. Verify `createdAt` values are interpreted as UTC-naive `TIMESTAMP(3)` consistent with the existing schema; explicitly test an Asia/Yangon midnight crossing.

## Mobile endpoint tests

All requests use the installed-client path/body:

```json
{ "params": { "partner_id": 123, "qr_token": "valid-permanent-payload" } }
```

| Case | Expected result |
| --- | --- |
| Valid Member JWT, active self Member, active credential | Existing JSON-RPC success envelope; source `QR`, `qrToken = null`, `createdById = null`. |
| Missing JWT | Passport rejection; no row. |
| Admin JWT or unknown `loginType` with a numeric ID that overlaps a Member | Passport rejection; no row. |
| `partner_id` differs from authenticated Member | Existing JSON-RPC forbidden failure; no row. |
| Inactive/nonexistent Member | Existing JSON-RPC not-found failure; no row. |
| Missing/blank token | Existing schema validation failure; no row. |
| Incorrect but well-formed token | JSON-RPC `isFullFilled: false`, fixed invalid-credential message, no token echo, no row. |
| Revoked/replaced/no active credential | Same fixed invalid-credential failure, no row. |
| QR crypto configuration absent/malformed or active ciphertext cannot decrypt | Fixed JSON-RPC unavailable failure; no stack/key/ciphertext/payload in response or log fixture. |
| QR at `t`, manual at `t + 59:59.999` | one insert then known rolling conflict. |
| Manual at `t`, QR at `t + 59:59.999` | same outcome. |
| Same source or cross source at exactly `t + 60:00.000` | second insert succeeds. |
| Concurrent QR + manual requests for same Member | exactly one succeeds; other maps known trigger failure. |
| Concurrent requests for different Members | both succeed. |
| History list | response retains `qr_token` key as `null`, never raw secret; existing pagination/filter behavior stays intact. |

Use an isolated-test clock mechanism outside the production migration, or direct test transaction timestamps only in a protected test database. Do not include the Admin-local test GUC gate in the authoritative production migration.

## Credential tests

1. Create an active credential with disposable 32-byte AES and HMAC keys, then instantiate a fresh service and verify the same payload.
2. Assert ciphertext is not plaintext and fingerprint lookup plus timing-safe equality accepts only the exact payload.
3. Assert one-active unique-index races result in one active row only.
4. Assert revoked/replaced credentials do not validate.
5. Search captured application/error logs and response bodies for the test payload, HMAC fingerprint, IV, auth tag, ciphertext, JWT, and key material; none may appear.

## Release gate

Pass all above checks with synthetic data, have database/security owners review the migration and secret setup, and run a staging-equivalent smoke test only if the organization provides an approved non-production environment. This task does not authorize such a connection.
