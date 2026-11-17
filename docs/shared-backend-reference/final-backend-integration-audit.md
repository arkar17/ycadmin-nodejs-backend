# Final backend integration audit — downloaded mobile backend

## Scope and evidence

This audit directly inspected `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference`, which exists locally. It supersedes assumptions based only on earlier copied snippets. No database or live API was contacted; no migration, Prisma generator, install, source change, environment-file read, or credential-file read occurred.

The source schema and the prior copied schema are byte-identical (SHA-256 matched). The earlier schema mapping remains valid. This audit adds confirmed executable behavior, integration compatibility, and defects from the full downloaded backend.

## Runtime, routing, and Prisma facts

| Area | Confirmed behavior | Source |
|---|---|---|
| Application bootstrap | Express installs logger, JSON/urlencoded parsers, global in-memory Multer, permissive CORS, then routes at `/api`; Passport strategy is imported for side-effect registration. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/index.ts:1-34` |
| Route registry | Existing Admin routes are mounted beneath `/api/admin/v1`, including `/auth`, `/members`, `/member-requests`, `/payments`, `/attendances`, and `/member-plans`. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/index.ts:1-74` |
| Prisma version/configuration | Backend uses Prisma 7.5 packages and configures schema, migrations, and datasource URL externally in `prisma.config.ts`. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/package.json:1-54`; `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma.config.ts:1-13` |
| Client construction | Prisma Client is constructed with `@prisma/adapter-pg`, a `pg.Pool`, and `PrismaPg`; it uses `DATABASE_URL`. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/client.ts:1-11` |
| Schema history | The repository contains 70 migration directories. The schema’s generator output is relative to its original `prisma/` location, not the Admin documentation-copy location. | `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:7-15`; local migration-directory inventory |

The Admin project currently uses Prisma 6.19 and a schema-free dynamic wrapper. It is not compatible with the reference backend’s Prisma 7 client/adapter arrangement without an explicit, approved integration change.

## Confirmed authentication and authorization behavior

### JWT issuance

`POST /api/admin/v1/auth/sign-in` validates an email-or-username and password, looks up an active `User` that has a role named `SuperAdmin`, verifies the bcrypt password, and issues a JWT payload containing `{ id, loginType: "admin" }` with a 30-day expiry.

- Route: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/admin/v1/auth.route.ts:1-14`
- Validation: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/schemas/admin/v1/auth.schema.ts:1-22`
- Active/SuperAdmin lookup and token construction: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/controllers/admin/v1/auth.controller.ts:22-71`
- Password hashing/comparison and JWT signing: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/helpers/helper.ts:11-30`

This confirms that the existing Admin identity is `User`, not `Member`. `Member.clientType = admin` must not be used as an Admin authorization substitute.

### JWT hydration and permission lookup

The Passport JWT strategy extracts a bearer token, verifies it using `JWT_SECRET`, branches on `payload.loginType`, and for `admin` loads `User → UserRole → Role → RolePermission → Permission`. All other login types are resolved as `Member` records.

- Strategy: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/middlewares/passport/jwt-strategy.ts:1-60`
- RBAC relations: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:17-131`
- Permission guard: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/middlewares/guards/permission.guard.ts:1-31`

The guard collects hydrated permission names and requires every requested permission. The existing Member Directory route is protected by `member:list`; its detail route uses `member:read`.

- `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/admin/v1/member.route.ts:10-62`

### Compatibility conclusion

The Admin API should use the existing shared JWT contract (`id`, `loginType: "admin"`) and database-hydrated permissions, not the Admin project’s current token-supplied `roles` scaffold. For a Member Directory endpoint, the confirmed existing permission name is `member:list`.

The Admin implementation should deliberately improve the verifier by requiring a positive integer `id`, `loginType === "admin"`, an existing active `User`, and active roles/permissions before attaching a minimal principal. It must return 401 for invalid/non-Admin/disabled identities and 403 for an active Admin lacking `member:list`.

### Security and compatibility defects in the reference implementation

These are confirmed observations, not permission to alter the mobile backend:

1. JWT signing and verification use one environment secret, but the shown code sets no issuer, audience, explicit accepted algorithm, refresh, logout, token revocation, or key-rotation policy. The token lifetime is 30 days. `/app/helpers/helper.ts:16-30`; `/app/middlewares/passport/jwt-strategy.ts:12-15`.
2. The strategy rehydrates roles and permissions but does not require `User.status = ACTIVE`, `Role.status = ACTIVE`, or `Permission.status = ACTIVE`; a user disabled after sign-in can still resolve. `/app/middlewares/passport/jwt-strategy.ts:20-45`.
3. Any non-`admin` token payload is routed to the `Member` branch. An Admin adapter must reject that principal before any permission guard runs. `/app/middlewares/passport/jwt-strategy.ts:20-54`.
4. Login is hard-wired to the `SuperAdmin` role, while routes use granular permissions. This may intentionally constrain issuance, but it prevents permissioned non-SuperAdmin users from signing in through this controller unless another issuer exists. `/app/controllers/admin/v1/auth.controller.ts:29-50`.
5. CORS allows every origin while bearer authentication is used. `/app/index.ts:21-26`.
6. Error logging records stack traces and labels any authenticated principal as a `Member`; the Admin API’s structured, redacted logger is preferable. `/app/middlewares/handlers/error.handler.ts:6-23`; `/app/middlewares/logger.middleware.ts:5-24`.

## Existing Admin implementations: reusable patterns and defects

### Member Directory

Reusable facts:

- The existing endpoint is `GET /api/admin/v1/members`, authenticated with Passport and `member:list`. `/routes/admin/v1/member.route.ts:10-19`.
- Its service selects safe Member data and optional `profile`, `providerTypes`, `memberType`, and audit Users; it does not select `Member.password`. `/app/services/admin/v1/member.service.ts:14-71`.
- It supports separate name, code, email, phone, member-type, profile, and status filters. `/app/scopes/admin/v1/member.scope.ts:3-119`.

Do **not** copy the implementation verbatim:

- It uses page/perPage rather than the planned offset/limit envelope, permits unbounded or invalid numeric pagination, and orders only by ID. `/app/controllers/admin/v1/member.controller.ts:23-45`; `/app/services/admin/v1/member.service.ts:74-149`.
- Each optional profile filter overwrites `where.profile`, so combining gender, age, experience, or address filters silently drops previous profile criteria. `/app/scopes/admin/v1/member.scope.ts:68-112`.
- It returns raw profile URLs and broad profile/provider/audit data, not the intentionally minimized Admin DTO. `/app/resources/admin/v1/member/member.collection.ts:4-21`.
- It returns `memberType`, not an active membership plan. The schema has no direct Member-to-current-`MemberPlan` relation, so neither the existing endpoint nor a new endpoint can truthfully expose or filter a current plan without a separate confirmed rule. `/prisma/schema.prisma:247-323`.

### Membership requests and payments

The existing request route has `member-request:list`, `member-request:read`, and `member-request:update` permissions. `/routes/admin/v1/member-request.route.ts:10-38`.

Unsafe reuse findings:

- List/detail reads do not include related Member, MemberPlan, Payment, or duration data, and the resource returns the raw request object. `/app/services/admin/v1/member-request.service.ts:14-67`; `/app/resources/admin/v1/member-request/member-request.resource.ts:1-5`.
- Approval is not transactional: it updates the request and then updates the member separately. A failure can leave inconsistent state. `/app/services/admin/v1/member-request.service.ts:82-127`.
- Approval hardcodes `memberTypeId: 2` as the trainer type. `/app/services/admin/v1/member-request.service.ts:100-127`.
- The member-facing request creator looks up the active member type by name, but also contains a hardcoded gym-member type ID check. `/app/services/member/v1/membership/member-request.service.ts:333-370`.
- Payment acceptance/decline updates only Payment approval/cancellation fields; it does not create an entitlement/current plan. `/app/services/admin/v1/paymet.service.ts:163-205`; `/prisma/schema.prisma:961-1006`.
- The payment controller casts an Admin principal to `Member` before using its ID; this is a type/domain mismatch, even though both models use integer IDs. `/app/controllers/admin/v1/payment.controller.ts:40-65`.

Therefore, approval, payment, entitlement, and active-membership behavior remain blocked for the new Admin API.

### Attendance and QR

Confirmed implementation:

- The Admin attendance list/create routes require `attendance:list` / `attendance:create`. `/routes/admin/v1/attendance.route.ts:10-27`.
- Admin manual creation checks for a matching `memberId` and string `date`, then writes an attendance record with `createdById`. `/app/services/admin/v1/attendance.service.ts:154-176`.
- The member QR endpoint only validates that a non-empty `qr_token` is supplied, confirms the member is acting for themself, applies a one-hour recent-check-in check using `createdAt`, then stores the supplied token verbatim. It never verifies QR-token authenticity or expiry. `/app/schemas/member/v1/fitness/attendance.schema.ts:3-11`; `/app/services/member/v1/fitness/attendance.service.ts:46-86`.
- The latest attendance migration removes the per-member/day unique index and adds only `(memberId, createdAt)` plus nullable `qrToken`. `/prisma/migrations/20260903120000_attendance_allow_multi_checkin/migration.sql:1-8`.
- Member attendance responses expose stored QR token text. `/app/resources/member/v1/fitness/attendance.resource.ts:16-24`.

Consequences: the Admin API may eventually implement a read-only attendance list, but it must not implement QR issuance, token display, rotation, or manual-attendance policy by copying this behavior. The canonical local-calendar convention in current mobile code is `Asia/Yangon`, not an inferred server timezone. `/app/helpers/helper.ts:124-155`; `/app/services/member/v1/fitness/attendance.service.ts:89-112`.

### Media storage

The backend has a reusable upload helper, but it is not safe to adopt unchanged for privileged Admin uploads:

- It uses environment-provided object-storage credentials when available, otherwise writes to `public/uploads`. `/app/helpers/media-upload.ts:55-125`.
- It accepts up to 10 GiB, trusts the multipart-reported MIME type, does not inspect content or enforce an allowlist, and makes remote objects public-read. `/app/helpers/media-upload.ts:95-147`.
- Global `upload.any()` buffers every route’s multipart files in memory. `/app/index.ts:15-26`.

Use its existing URL/key compatibility helpers only after a separate media-security design establishes file limits, content inspection, private storage, signed access, retention, and deletion policy.

## Dashboard metric mapping

| Planned metric | Confirmed data source | Status / limitation |
|---|---|---|
| Users / new users | `Member.createdAt` | Available if dashboard scope explicitly defines “user” as `Member`; no declared global createdAt index. `/prisma/schema.prisma:247-278` |
| Membership request count / trend / recents | `MemberRequest.createdAt`, `status`, Member and MemberPlan relations | Current status can be counted; no status-transition history supports historical as-of status. `/prisma/schema.prisma:208-245` |
| Attendance visits / recents | `Attendance.createdAt`, `Attendance.date`, Member | Available only after selecting timestamp semantics; mobile code treats `createdAt` as check-in time and formats it in Yangon time. `/prisma/schema.prisma:1008-1023`; `/app/services/member/v1/fitness/attendance.service.ts:54-85` |
| Attendance today | Same | Possible only with explicit timezone policy. Existing helper uses `Asia/Yangon`, while Admin planning proposed a caller-selected IANA zone. |
| Active members, new members, existing members | None | **Unsupported.** No entitlement/current membership/effective start/end/cancellation/renewal model exists. `Payment` and `MemberRequest` are not safe substitutes. |
| Active membership distribution | None | **Unsupported.** No authoritative active Member-to-Plan relation exists. |
| Revenue | `Payment.amount` exists | **Unspecified.** Payment status and request type exist, but accounting/refund/currency rules and time semantics are not confirmed; do not build dashboard revenue. |

The mobile `yc.dashboard` route is unrelated to operational Admin metrics: it only returns static `Dashboard` records for privacy policy or terms. `/routes/member/v1/members/dashboard.route.ts:1-13`; `/app/controllers/member/v1/members/dashboard.controller.ts:25-65`; `/prisma/schema.prisma:1397-1410`.

## Hardcoded-secret review

A source-only scan of TypeScript/JavaScript files reported no likely literal assignment to a JWT/API/access secret under the applied detection pattern; the JWT and object-storage helpers reference environment variables. This is not a credential audit or a guarantee that no secret is present.

One Firebase/service-account-style JSON filename was discovered by name only and was **not opened, printed, or copied**, as required. Environment files and credential files were excluded from inspection. The static bucket/endpoint behavior and public-read policy in the media helper are configuration/security concerns but were not treated as secrets.

## Safe Admin Prisma and isolated-database strategy

1. Keep the downloaded backend as read-only evidence. Do not point the Admin project at its `DATABASE_URL`, reuse its `.env`, or generate from the copied documentation schema path.
2. In an approved future integration change, align the Admin project to the pinned upstream Prisma 7.5 package family and the exact schema/migration revision. The verified reference client requires `pg` and `@prisma/adapter-pg` with `PrismaPg`; preserve lazy construction so health checks never connect.
3. Put the approved schema in an Admin-owned integration location (or consume an approved shared Prisma package). The reference generator output is relative to `prisma/schema.prisma`; copying it under `docs/` changes its output path and is unsafe.
4. Generate only after a local/test `DATABASE_URL` is configured and owner approval is given. Prisma generation does not authorize migration execution; do not run `db push`, `migrate dev`, `migrate deploy`, or reset commands from the Admin project until separately authorized.
5. Use two separate local-only databases and credentials: `yc_fitness_admin_dev` for developer work and `yc_fitness_admin_test` for automated tests. Populate only with synthetic/sanitized data and owner-approved migration application. Never import a production dump.
6. Do not reuse the reference Docker Compose deployment topology: it uses host networking and an `.env` file. Any Admin local Compose setup should use an isolated network, fixed local port, named local-only volumes, and a least-privilege role.
7. In development, verify shared-compatible tokens using a dedicated local development signing secret—not a production secret—and hydrate every Admin principal from the isolated database. A longer-term shared identity service or asymmetric verification needs coordinated mobile-backend work; it is not authorized by this audit.

## Reusable Admin code and compatibility requirements

Reuse the **contracts/patterns**, not direct code:

- Existing route permission names: `member:list`, `member:read`, `member-request:list`, `payment:list`, and `attendance:list` are confirmed in the reference routes.
- Existing Admin identity lookup shape and RBAC relation include are the correct base for a typed `AdminPrincipalResolver`.
- Existing Member selection demonstrates the schema-safe fields needed for a directory, excluding password.
- Existing Member code (`Member.code`) is the confirmed client-code field, and `Attendance.memberId` confirms the only persisted attendance subject relation.

The new Admin API must retain its REST `{ data, pagination }` and structured-error envelope; it should not copy the backend’s `{ status, message, data }` or JSON-RPC contracts. It must cap/validate pagination, use composed Prisma filters, exclude raw profile storage keys and QR tokens, and document active-plan fields/filtering as unsupported.

## Concrete first implementation task

After the isolated Prisma client and synthetic test database are approved, implement one vertical read-only slice:

1. Replace the local JWT-role scaffold with a shared-contract `authenticateAdmin` adapter that verifies bearer tokens, requires `loginType: "admin"`, resolves an active User with active roles/permissions, and attaches a minimal principal.
2. Add `requirePermission("member:list")`.
3. Implement `GET /api/admin/v1/members` with Zod-validated `name`, combined `contact` (phone/email), bounded `limit`/`offset`, deterministic ordering, and a narrow Member/Profile/MemberType DTO.
4. Return `memberPlan: null` only if the contract explicitly labels it unavailable, or omit it under a versioned DTO decision; do not derive it from request/payment history. Do not expose a profile storage key or raw URL absent a media authorization rule.
5. Add unit tests using a repository fake and integration tests against `yc_fitness_admin_test` for 401, 403, pagination, combined filters, optional profile, and no-data behavior.

## Remaining decisions before implementation

1. Owner approval for the Admin project to use the exact Prisma 7.5 schema/client configuration and migrations on isolated databases.
2. A local development JWT compatibility policy: token issuer, allowed algorithm, development-only secret provisioning, and whether issuer/audience enforcement can be added without breaking current mobile tokens.
3. The definitive semantics of inactive Users/Roles/Permissions during request authentication.
4. The REST decision for unsupported Member Directory fields: current membership plan/filter, authorized profile URL, and whether `Member.id` is published as `attendanceSubjectId`.
5. Approval of the real permission seed/assignment containing `member:list` for the isolated test fixture.
6. A future, separate product/security decision for QR issuance and membership entitlements; neither is safe to infer from the backend source.

## New backend files inspected

The following downloaded backend files were inspected directly (credential-file contents were not inspected):

- Root/config/bootstrap: `package.json`, `prisma.config.ts`, `server.ts`, `app/index.ts`, `routes/index.ts`, `prisma/client.ts`, `prisma/schema.prisma`, `prisma/migrations/20260903120000_attendance_allow_multi_checkin/migration.sql`, `docker-compose.yml`, `docker-compose.mac.yml`.
- Auth/RBAC/helpers: `app/controllers/admin/v1/auth.controller.ts`, `routes/admin/v1/auth.route.ts`, `app/schemas/admin/v1/auth.schema.ts`, `app/helpers/helper.ts`, `app/middlewares/passport/jwt-strategy.ts`, `app/middlewares/guards/permission.guard.ts`, `app/middlewares/handlers/async.handler.ts`, `app/middlewares/handlers/error.handler.ts`, `app/middlewares/logger.middleware.ts`, `app/helpers/response.ts`, `app/helpers/exceptions.ts`, `app/services/admin/v1/user.service.ts`, `app/services/admin/v1/role.service.ts`, `app/services/admin/v1/permission.service.ts`, `routes/admin/v1/role.route.ts`.
- Member directory: `routes/admin/v1/member.route.ts`, `app/controllers/admin/v1/member.controller.ts`, `app/services/admin/v1/member.service.ts`, `app/scopes/admin/v1/member.scope.ts`, `app/resources/admin/v1/member/member.resource.ts`, `app/resources/admin/v1/member/member.collection.ts`, `app/schemas/admin/v1/member.schema.ts`.
- Membership/payment/attendance: `routes/admin/v1/member-request.route.ts`, `app/controllers/admin/v1/member-request.controller.ts`, `app/services/admin/v1/member-request.service.ts`, `app/scopes/admin/v1/member-request.scope.ts`, `app/resources/admin/v1/member-request/member-request.resource.ts`, `routes/admin/v1/payment.route.ts`, `app/controllers/admin/v1/payment.controller.ts`, `app/services/admin/v1/paymet.service.ts`, `app/scopes/admin/v1/payment.scope.ts`, `app/resources/admin/v1/payment/payment.resource.ts`, `routes/admin/v1/attendance.route.ts`, `app/controllers/admin/v1/attendance.controller.ts`, `app/services/admin/v1/attendance.service.ts`, `app/scopes/admin/v1/attendance.scope.ts`, `app/resources/admin/v1/attendance/v1/attendance.resource.ts`, `routes/member/v1/fitness/yc-attendance.route.ts`, `app/controllers/member/v1/fitness/attendance.controller.ts`, `app/services/member/v1/fitness/attendance.service.ts`, `app/resources/member/v1/fitness/attendance.resource.ts`, `app/schemas/member/v1/fitness/attendance.schema.ts`, `routes/member/v1/membership/member-request.route.ts`, `app/controllers/member/v1/membership/member-request.controller.ts`, `app/services/member/v1/membership/member-request.service.ts`.
- Plans/media/dashboard: `routes/admin/v1/member-plan.route.ts`, `app/controllers/admin/v1/member-plan.controller.ts`, `app/services/admin/v1/member-plan.service.ts`, `app/helpers/media-upload.ts`, `app/helpers/media-line.ts`, `routes/member/v1/members/dashboard.route.ts`, `app/controllers/member/v1/members/dashboard.controller.ts`.

The required new document, `docs/shared-backend-reference/final-backend-integration-audit.md`, has been created in the Admin workspace.
