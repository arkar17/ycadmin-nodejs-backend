# YC Fitness Admin API v1

Infrastructure foundation for the YC Fitness Admin REST API. The current frontend uses Odoo; this repository is the separate local Admin API workspace that will eventually share the mobile backend's established PostgreSQL and Prisma ownership model.

## Current scope

Implemented now:

- TypeScript, Express, Zod, Pino logging, JWT verification scaffold, and Vitest test setup.
- Versioned API mount at `/api/admin/v1`.
- Database-independent `GET /api/admin/v1/health` returning `{ "data": { "status": "ok" } }`.
- Standard data, collection, validation, and error response infrastructure with request IDs.
- Lazy Prisma Client boundary that does not instantiate or connect during startup.
- Empty module boundaries for auth, members, membership requests, plans, types, durations, bank information, attendance, QR, feedback, workouts, and dashboard.

Not implemented: login/session issuance, membership approval, QR replacement/revocation, uploads, dashboard statistics, production access, deployment, and frontend changes.

## Requirements

- Node.js 22 or later
- npm 10 or later

## Setup

```bash
npm install
cp .env.example .env
```

Replace the placeholder `JWT_SECRET` in `.env` with a local development secret of at least 32 characters. It must be compatible only with locally issued development tokens—never copy a production secret. `DATABASE_URL` must name a local or isolated test PostgreSQL database; health checks and mock-based tests do not connect to it.

Permanent attendance QR management also requires two approved-secret-manager values: canonical-base64 `ATTENDANCE_QR_ENCRYPTION_KEY` (exactly 32 decoded bytes for AES-256-GCM) and `ATTENDANCE_QR_HMAC_KEY` (at least 32 decoded bytes). Do not place production values in `.env`, logs, database rows, or source control. If absent, the QR endpoints fail closed with `503 QR_CREDENTIAL_UNAVAILABLE`.

The Admin schema is synchronized from the verified mobile-backend schema. Generate its client after confirming the schema revision and local database URL:

```bash
npm run prisma:generate
```

This generation step does not connect to PostgreSQL or apply migrations. Do not run Prisma migration, push, reset, or seed commands against shared, staging, or production databases. The checked-in migration history is an unchanged copy of the verified reference backend history and is used only for the dedicated local integration database described below.

## Authentication foundation

The API accepts only bearer tokens using the verified shared payload shape `{ id, loginType: "admin" }`. It rehydrates the active `User` and active role/permission assignments from Prisma on each protected request; permissions follow the shared convention (for example, `member:list`). It does not implement token revocation, refresh, issuer/audience claims, or key rotation because those production conventions remain owned by the shared backend.

## Local Admin login

`POST /api/admin/v1/auth/login` accepts `{ "emailOrUsername", "password" }`, verifies the existing bcrypt cost-10 `User.password` hash, requires an active User, and returns only an expiring HS256 Admin token with `{id, loginType:"admin"}`. It does not grant roles or permissions; protected requests always hydrate current database-backed RBAC. Login is locally throttled per IP (10 attempts / 15 minutes) and must move to trusted ingress/shared rate limiting before scaled production use.

There is no token revocation or server-side logout mechanism in the verified shared design. Browser logout can only clear a memory-held token. See `docs/shared-backend-reference/admin-authentication-stage-3f.md`.

## Member Directory

`GET /api/admin/v1/members` is registered in `/api/admin/v1` after Prisma-backed, isolated PostgreSQL integration verification. The endpoint supports `name`, `contact`, `limit` (1–100), and `offset`; it requires `member:list`.

The verified schema has no current Member-to-Plan relation. `memberPlanId` and the legacy `member_plan_id` are therefore rejected with a validation error, and each safe DTO reports `memberPlan: null`. The endpoint does not expose `attendanceSubjectId`, profile image URLs/storage keys, passwords, provider tokens, or raw media fields.

## Membership Requests (read-only)

`GET /api/admin/v1/membership-requests` and `GET /api/admin/v1/membership-requests/:id` are enabled. List filters are `memberName`/`member_name`, `memberPlanId`/`member_plan_id`, canonical `status` (`PENDING`, `APPROVED`, `REJECTED`), `date`, `limit` (1–100), and `offset`. The date filter uses Asia/Yangon calendar-day boundaries converted to UTC instants.

List and detail require `member-request:list` and `member-request:read`, respectively. Payment proof data is limited to a boolean availability indicator; attachment keys and URLs are never exposed. Legacy Odoo `draft` and `paid` values are rejected rather than being silently mapped. Approval/rejection remains deliberately unimplemented pending an owner-approved transactional lifecycle. See `docs/shared-backend-reference/membership-request-compatibility.md`.

## Attendance (read-only)

`GET /api/admin/v1/attendance` requires `attendance:list`. It supports `memberName`/`name`, `memberCode`/`member_code`, `dateFrom`/`date_from`, `dateTo`/`date_to`, `limit` (1–100), and `offset`. Date ranges use the canonical `Attendance.createdAt` instant with Asia/Yangon inclusive-start/exclusive-end calendar boundaries; the legacy string `Attendance.date` is returned only as `recordedDate`.

The DTO exposes only safe attendance and member fields. It deliberately omits `qrToken` and does not fabricate a current membership plan or legacy Odoo `partner_id`. QR issuance/validation, edits, and deletion are not provided. See `docs/shared-backend-reference/attendance-compatibility.md`.

## Manual Attendance

`POST /api/admin/v1/attendance/manual` accepts the strict body `{ "memberId": 123 }` and requires `attendance:create`. It verifies only that the canonical Member exists and is `ACTIVE`; it does not inspect plans, payments, or membership entitlement. The database trigger assigns the UTC check-in timestamp and Yangon legacy display date, records `source: "MANUAL"`, and the service records the authenticated Admin as `createdById`.

The endpoint returns `409 ATTENDANCE_RECENTLY_RECORDED` for the database-enforced rolling 60-minute conflict, `404 MEMBER_NOT_FOUND`, or `409 MEMBER_INACTIVE`. QR tokens, client timestamps, and client date fields are rejected or omitted.

## Permanent Attendance QR

`POST /api/admin/v1/attendance/qr` creates the one permanent printable credential only when none is active, and `GET /api/admin/v1/attendance/qr` returns the exact stored payload for intentional reprinting. They require an active Admin JWT plus `attendance-qr:create` and `attendance-qr:read`, respectively. The payload is AES-256-GCM encrypted in PostgreSQL and HMAC-fingerprinted for verification; keys are supplied only through process configuration. Both responses use `{data:{credentialId,qrPayload,createdAt}}` and strict `no-store` cache headers.

No replacement/revocation/history/public QR route exists. The shared mobile backend must adopt the authoritative schema/trigger and explicit permissions before production use; see `docs/shared-backend-reference/attendance-qr-permission-provisioning.md`.

## Feedback

`GET /api/admin/v1/feedback` and `GET /api/admin/v1/feedback/:id` provide read-only `ClientFeedback` access. The list accepts `name`, canonical `clientCode` (and the frontend compatibility alias `client_code`), `date` (`YYYY-MM-DD`), `limit` (1–100), and `offset`. It returns the REST DTO `{id, feedbackMessage, member:{id,name,clientCode}, createdAt}`.

List access requires `feedback:list`; detail access requires `feedback:read`. Calendar-date filtering uses Asia/Yangon midnight boundaries and queries UTC instants in `[local midnight, next local midnight)`. The new permissions are synthetic only in the isolated test database until the shared-backend owner provisions them explicitly; see `docs/shared-backend-reference/feedback-permission-provisioning.md`.

## Plan Durations

`GET`, `POST`, `PATCH /:id`, and `DELETE /:id` are available at `/api/admin/v1/plan-durations`. List input supports `name`, `limit` (1–100), and `offset`; mutation bodies use `{ "name": "3 Months", "value": 3 }` (PATCH accepts either field). Responses expose only `{id,name,value}`.

The permissions are `plan-duration:list`, `plan-duration:create`, `plan-duration:update`, and `plan-duration:delete`. They are proposed permissions and are seeded only for synthetic isolated-test roles until the shared-backend owner explicitly provisions them. Deletion and all updates are rejected with `409 DURATION_IN_USE` while a duration is referenced by `MemberPlan` or `ShopLevel`; the schema has no PlanDuration inactive/status field. See `docs/shared-backend-reference/plan-duration-permission-provisioning.md`.

## Member Types and Plan Levels

`GET /api/admin/v1/member-types?name&status&limit&offset` is a verified, read-only MemberType reference-data endpoint requiring `member-type:list`. It returns `{id,name,status}` and is deliberately separate from the legacy Odoo Plan Levels UI.

No `/plan-level-types` endpoint and no MemberType mutation route are provided: Odoo needs `level_count` and `post_limit_count`, which no verified Prisma model supplies together. MemberType deletion is unsafe because of cascading and restricted relations. See `docs/shared-backend-reference/member-type-plan-level-compatibility.md`.

## Member Plans

`GET /api/admin/v1/member-plans`, `GET /api/admin/v1/member-plans/:id`, `POST`, `PATCH /:id`, and `DELETE /:id` use the verified ID-based contract: `memberTypeId`, `durationId`, `prosIds`, `consIds`, `price`, `isVideoGroup`, and `status`. Reads may filter by `name`, `memberTypeId`, and `status` with bounded offset pagination.

The routes require the confirmed `member-plan:list`, `member-plan:read`, `member-plan:create`, `member-plan:update`, and `member-plan:delete` permissions. A plan referenced by MemberRequest, Payment, Workout, Conversation, or Channel cannot be updated or deleted. Image uploads, Odoo `data_type`, `level_id`, and free-text pros/cons are intentionally unsupported. See `docs/shared-backend-reference/member-plan-compatibility.md`.

## Bank Information

`GET`, `POST`, `PATCH /:id`, and `DELETE /:id` are enabled at `/api/admin/v1/bank-information`. List filters are `name`, `bankOrPhone` (the read-only compatibility alias `bank_or_phone` is accepted), `paymentType` (`BANK_ACCOUNT` or `E_WALLET`), `status`, `limit` (1–100), and `offset`. Write bodies use `{name, paymentType, accountNumber, accountHolder, phone, status?}`.

The shared permission catalog already defines `bank-information:list`, `bank-information:read`, `bank-information:create`, `bank-information:update`, and `bank-information:delete`; each must be granted explicitly to an Admin role. List responses mask account numbers. Full account numbers are returned only from the separately authorized detail, create, and update operations; they are never included in conflict or error payloads. `coverPhoto` is deliberately neither uploaded nor exposed. The approved future direction is private DigitalOcean Spaces objects with short-lived signed URLs for restricted images; public payment QR images still require a separate access-policy decision. A payment-referenced destination cannot be changed or deleted (`409 BANK_INFORMATION_IN_USE`). See `docs/shared-backend-reference/bank-information-compatibility.md`.

## Isolated integration database

`docker-compose.integration.yml` defines the only database used by integration tests: PostgreSQL 16 at `127.0.0.1:55432`, database `yc_fitness_admin_integration`, with local-only synthetic credentials. It is not configured through `.env` and must never be pointed at a shared database.

```bash
docker compose -f docker-compose.integration.yml up -d postgres-integration
DATABASE_URL='postgresql://yc_fitness_integration:yc_fitness_integration_local_only@127.0.0.1:55432/yc_fitness_admin_integration?schema=public' npx prisma migrate deploy --schema prisma/schema.prisma
npm run test:integration
```

The integration suite accepts only the exact dedicated database name on `localhost`/`127.0.0.1` before running its `TRUNCATE ... CASCADE` fixture reset. Fixtures are created in code with synthetic `example.test` identities; no reference or production records are imported.

## Commands

```bash
npm run dev        # start the TypeScript development server
npm run build      # compile src/ to dist/
npm run typecheck  # run TypeScript checks without output
npm run prisma:generate # generate Prisma Client only; no migration or database connection
npm test           # run infrastructure tests once
npm run test:integration # run isolated PostgreSQL integration tests
npm run test:watch # run Vitest interactively
npm start          # run the compiled server
```

## Project structure

```text
src/
  app.ts                 Express composition root
  server.ts              HTTP startup
  config/                environment and logging
  database/              lazy Prisma boundary (no schema)
  middleware/            validation, authentication scaffold, errors
  modules/               domain boundaries; feature logic intentionally absent
  routes/                /api/admin/v1 registration
  shared/                API envelopes and shared errors
  tests/                 Vitest setup
prisma/                  schema-ownership guidance only
docs/                    architecture notes
```

## Before feature development

Obtain the authoritative shared mobile-backend Prisma schema, migrations, authentication/role conventions, media abstraction, audit convention, membership state machine, attendance policy, and QR validation contract. The planning documents in the Admin frontend identify these as required discovery work; frontend/Odoo field names must not be treated as database facts.
