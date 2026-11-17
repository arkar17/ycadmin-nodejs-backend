# Authentication and Prisma integration plan

## Scope and evidence

This plan is a documentation-only assessment of the copied mobile-backend reference files in this directory:

- [`backend/middlewares/passport/jwt-strategy.ts`](./backend/middlewares/passport/jwt-strategy.ts)
- [`backend/middlewares/guards/permission.guard.ts`](./backend/middlewares/guards/permission.guard.ts)
- [`schema.prisma`](./schema.prisma)
- [`admin-schema-compatibility.md`](./admin-schema-compatibility.md)

No application code, reference file, generated Prisma Client, database, or migration was changed or executed while preparing this plan. The copied files establish implementation direction, but they are not a complete mobile repository or proof of deployed configuration.

## Confirmed mobile JWT and authorization flow

The copied Passport strategy uses `ExtractJwt.fromAuthHeaderAsBearerToken()`. It therefore expects an `Authorization: Bearer <JWT>` header and verifies the signature with `process.env.JWT_SECRET`.

After cryptographic verification, it branches by `payload.loginType`:

| Token payload branch | Lookup | Principal returned to Passport |
|---|---|---|
| `loginType === "admin"` | `prisma.user.findFirst({ where: { id: payload.id }, include: roles → role → permissions → permission })` | A `User` with hydrated `UserRole`, `Role`, `RolePermission`, and `Permission` data |
| Any other value | `prisma.member.findUnique({ where: { id: payload.id }, include: profile, memberType, providerTypes })` | A `Member` with mobile-profile data |

The copied permission guard reads `req.user.roles`, flattens each role’s `RolePermission.permission`, and requires **every** requested permission name to be present. This is database-hydrated authorization, rather than trusting a role list included in the JWT.

The schema corroborates the relational lookup:

```text
User --< UserRole >-- Role --< RolePermission >-- Permission
```

`UserRole` is unique per `(userId, roleId)` and `RolePermission` is unique per `(roleId, permissionId)`. `User`, `Role`, and `Permission` all have a `status` field, but the copied strategy and guard do not filter that field.

## Identity separation

`User` and `Member` are separate models with independent numeric IDs and no direct relation.

- `User` is the schema-backed administrative identity: it has `username`, `password`, roles, and is referenced as the creator/approver/updater of Admin-managed records.
- `Member` is the mobile/customer identity: it has a client `code`, mobile credentials/providers/profile, and domain links such as attendance and feedback.
- `Member.clientType` includes an `admin` enum value, but it is not the RBAC model used by the copied Passport strategy. It must not authorize Admin routes.

For the Admin API, a verified `loginType: "admin"` token must resolve to an active `User` principal, and permission checks must use that User’s current database roles and permissions. A resolved `Member` is authenticated for mobile purposes but is not an Admin principal.

## Weaknesses and gaps to resolve before reuse

### Current local scaffolding

`src/middleware/authenticate.ts` is intentionally only scaffolding and is unsafe as the final Admin boundary:

- It verifies against this workspace’s `JWT_SECRET`, which may not be the shared backend’s issuer key or token policy.
- It requires `sub` and trusts a token-provided `roles` array. It does not use the mobile payload’s observed `id` and `loginType` contract.
- It performs no database principal lookup, so it cannot determine whether a `User` exists, remains active, lost a role, or lost a permission after the token was issued.
- It has no permission middleware; successful JWT verification is the only access decision.
- It does not establish issuer, audience, accepted algorithm, token-type, or key-rotation policy.
- It has no session/token revocation, refresh, or logout behavior and must not become a second Admin token issuer.

The current `src/database/prisma.ts` also intentionally exposes only `$disconnect`; it cannot execute typed `user`, `member`, or role/permission queries. It is not an implementation-ready data layer.

### Copied mobile middleware

The copied middleware is useful evidence, but must be verified and hardened with the mobile owner before it is reused:

- The strategy reads `payload.id` and `payload.loginType` but does not validate their type or presence before querying.
- The branch treats every non-`admin` `loginType` as a Member; Admin route registration must enforce the Admin principal path and never rely on a generic Passport success alone.
- It uses `findFirst` for a unique `User.id`; `findUnique` would express the schema invariant, though this is an owner-approved source-code decision rather than an Admin-local change.
- It does not filter `User.status`, `Role.status`, or `Permission.status`. The intended disabled-account/role/permission semantics must be confirmed.
- Its options do not show issuer, audience, or accepted-algorithm constraints. Confirm the signing algorithm, issuer/audience claims, expiry handling, and key rotation before configuring the Admin verifier.
- `hasPermission` relies on nested includes and `any` casts. It requires all named permissions, which is appropriate only if the Admin permission matrix confirms that behavior.
- The source files for Passport initialization, login/token issuance, refresh/revocation/logout, `prisma/client`, exceptions, response handling, route order, and current permission names are not present. They are needed to establish actual behavior.

## Recommended compatible Admin authentication design

Do not create a new Admin table, local JWT issuer, token format, or authorization bypass. Adapt the verified mobile authentication contract behind Admin-specific middleware.

```text
Bearer token
  → verified using the shared backend’s approved JWT configuration
  → reject unless the token is an Admin login type
  → resolve current User + roles + role permissions from the shared schema
  → reject absent/inactive principal according to owner-confirmed status rules
  → attach a minimal Admin principal: userId, displayName, roleNames, permissionNames
  → require endpoint permission (for member directory: owner-confirmed equivalent of admin.users.read)
  → controller/repository
```

Required status behavior should be explicit: missing/invalid token is `401`; a valid token that resolves to no Admin User or inactive User is normally `401`; an authenticated active User lacking the endpoint permission is `403`. Follow the shared backend’s exception/response convention or map it at the Admin adapter boundary without exposing database errors.

The token should be treated only as proof of authentication context. Current permissions must come from the database lookup on each request unless the backend owner provides an approved, bounded permission-cache/revocation design. The resolved principal must omit `password`, JWT material, raw role join objects, and any mobile-member secrets.

### Permission decision needed

The planning documents propose `admin.users.read`, but the copied schema does not contain permission records. Before implementation, the mobile owner must provide the canonical permission name assigned to the member directory (or approve adding it through the shared backend’s established role/permission process). The Admin workspace must not invent and seed it independently.

## Required source files and decisions for verification

Request these from the shared backend owner before implementing the adapter:

| Needed artifact or decision | Why it is required |
|---|---|
| JWT issuing login controller/service and token payload type | Confirms `id`, `loginType`, expiry, algorithm, issuer, audience, subject semantics, and whether Admin tokens differ from Member tokens. |
| Passport/bootstrap and route-registration code | Confirms strategy loading, `passport.authenticate` options, middleware ordering, and failure handling. |
| Auth/session/refresh/logout or revocation service | Determines whether logout/revocation exists and how disabled or revoked credentials are rejected. |
| Prisma client factory plus Prisma/Node package versions | Confirms schema location, datasource configuration, generated-client output, extensions, logging, and singleton lifecycle. |
| Role/permission seed or authoritative permission catalogue | Supplies the actual Admin role names and member-directory permission instead of inventing `admin.users.read`. |
| Status semantics for User, Role, Permission | Determines whether `INACTIVE` must deny authentication or authorization. |
| Shared exception/response helpers and tests | Lets Admin map 401/403 and errors consistently without leaking details. |
| Exact schema revision, migrations, `prisma.config.*`, and environment conventions | Ensures the generated client matches the deployed shared database without copying an incomplete schema snapshot. |
| Non-production database/fixture policy | Required for integration tests; no production data or credentials belong in this workspace. |

## Safe Prisma Client generation plan

The copied schema is not safe to generate from as-is in this workspace:

- Its datasource contains only `provider = "postgresql"`; a required URL/configuration source is absent from this copy.
- Its `output = "../node_modules/.prisma/client"` is relative to the schema’s original location. In this copied `docs/shared-backend-reference/` location, that output would resolve differently from the mobile repository’s expected layout.
- The installed Admin `@prisma/client` was not generated from this verified schema, and the current wrapper deliberately has no model delegates.

After owner approval, use this sequence in a dedicated integration change:

1. Pin the exact upstream schema revision, migration set, Prisma version, and configuration convention. Preserve source/revision metadata.
2. Place that approved schema at an Admin-owned integration path with a generator output that is local and ignored, or consume an owner-approved shared Prisma package. Do not edit the reference copy.
3. Configure only a local or isolated test `DATABASE_URL`; generation must never receive production or staging credentials.
4. Generate the client from the pinned schema as an explicit development/CI action. Prisma Client generation is separate from applying migrations, but run neither until the schema/configuration has been approved.
5. Replace the opaque local Prisma wrapper with a typed singleton only in the same change that adds the verified schema artifact. Disconnect it in test teardown; do not connect at application startup or health checks.
6. Query through narrow read repositories and DTO mappers. Keep model names, storage keys, and password fields out of response types.

## Isolated development and test database design

Use two separate local-only PostgreSQL databases or containers:

| Environment | Purpose | Safety controls |
|---|---|---|
| `yc_fitness_admin_dev` | Manual local development | Local container or explicitly approved non-production host; dedicated least-privilege role; non-production credentials only; separate named volume/network; no production dump. |
| `yc_fitness_admin_test` | Automated integration tests | Separate database and role, created/reset only by approved test tooling; sanitized minimal fixtures; teardown/transaction isolation; never share with the development database. |

Additional controls:

- Keep `DATABASE_URL` in uncommitted local environment files and reject known production/staging hosts in future configuration validation.
- Build sanitized fixtures from business-approved synthetic records: an active Admin `User`, roles and permissions, inactive/unauthorized cases, Members with and without optional profiles, and only the relations needed by the endpoint.
- Do not restore production backups, copy real passwords, reuse access tokens, or add mobile API secrets.
- Have the mobile owner approve the migration application mechanism for the isolated databases. This Admin workspace must not create migrations or apply schema changes to shared environments.
- Test read endpoints with a database role that has only the permissions required by the agreed shared-service policy; this is defense in depth, not a replacement for API authorization.

## Read-only endpoint work possible with repository mocks

Mocks can support API-layer development before database integration when they implement a narrow repository interface and return only schema-confirmed fields. They must not simulate missing membership or authorization facts as if they were real.

| Read-only slice | Mock-first viability | Limits to retain |
|---|---|---|
| Member directory | Yes: validation, pagination, name/contact filtering, DTO mapping, 401/403, and absent-profile handling | No current active `memberPlan`, plan filter, confirmed `attendanceSubjectId`, or authorized `profileUrl` mapping. Do not mock those as real database fields. |
| Member plans and plan durations | Yes: list/detail pagination/filter DTO behavior | Keep the unverified plan-duration precedence and media URL policy out of mocks. |
| Bank information | Yes: list/filter and sensitive-field DTO decisions | Account-number masking and image authorization require product/security policy. |
| Workouts | Yes: list/detail mapping and category/plan filters | `isFreeVideo`, calories, storage metadata, and upload policy are absent. |
| Membership-request list/detail | Yes for structural joins and current schema status values | Do not map `PENDING`/`APPROVED` to Odoo vocabulary or invent request number, proof, price snapshot, or expiry. |
| Feedback | Conditional | Confirm whether `ClientFeedback.name` is the intended message field first. |
| Attendance list | Conditional | Confirm whether string `date` or `createdAt` is the event time, plus timezone/source semantics. |
| Dashboard / QR / approval actions | No | The schema and business contracts are insufficient; mocks would conceal critical missing behavior. |

Repository mocks are appropriate for controller and security-contract tests only. They do not validate Prisma query correctness, relation cardinality, schema deployment, or database performance; isolated-database tests remain required before routes are enabled.

## Remaining implementation prerequisites

1. The mobile owner’s JWT issuance and Passport initialization files, plus confirmed token claims and verification settings.
2. The authoritative Admin permission catalogue/role assignments and active-status rules.
3. The shared Prisma client/configuration artifacts, exact schema revision, migration history, and supported generated-client process.
4. An approved local/test database policy and sanitized fixture set.
5. Confirmation of Member Directory’s unsupported fields: active membership-plan source/filter, attendance-subject ID, and authorized profile URL behavior.
6. Approval to replace the current local JWT scaffolding with a shared-contract Admin principal resolver and permission middleware.
