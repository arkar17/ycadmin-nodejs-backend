# Shared RBAC Provisioning Plan — Phase 3Q

## Scope and evidence

This is a review-only plan. It does not provision permissions, grant roles, contact a
database, or alter either backend. The route inventory was taken from the Admin API
router and module routers in this workspace. The catalog comparison is against
`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts`.

The shared schema stores identities and authorization as follows:

- `User` is the Admin identity table; `User.status` must be `ACTIVE`.
- `Role` has an active/inactive `Status` and connects to `User` through `UserRole`.
- `Permission` has a unique `name`, a `Status`, and connects to roles through
  `RolePermission`.
- Both join tables have unique composite keys. The Admin API resolves this graph on
  every protected request and includes only active roles and permissions. See
  `src/modules/auth/admin-identity.repository.ts`.

The reference `role.seeder.ts` is **not safe for this rollout**: it attaches every
catalog permission to both `SuperAdmin` and `Admin` whenever it runs. It must not be
run as the mechanism for introducing the nine permissions below. Permission definition
and role assignment must be separate, reviewed changes.

## Exact Admin v1 permission matrix

“Catalog” means present in the downloaded reference seeder, not that it is assigned to
any particular production role. “Proposed” means absent from that catalog and requires
owner approval before any shared-environment route can authorize it.

| Area | Registered Admin v1 route use | Catalog state | Provisioning action |
| --- | --- | --- | --- |
| Member Directory | `member:list` | Present | None; grant only through a separately approved role assignment. |
| Plan Durations | `plan-duration:list`, `:create`, `:update`, `:delete` | **Proposed / absent** | Add four definitions after approval. |
| Member Plans | `member-plan:list`, `:read`, `:create`, `:update`, `:delete` | Present | None. |
| Member Types | `member-type:list` | Present | None. `:read/create/update/delete` are cataloged but unused by this Admin API. |
| Bank Information | `bank-information:list`, `:read`, `:create`, `:update`, `:delete` | Present | None. |
| Feedback | `feedback:list`, `feedback:read` | **Proposed / absent** | Add two definitions after approval. |
| Membership Requests | `member-request:list`, `:read`, `:update` | Present | `:update` protects the transactional approve/reject decision routes. |
| Attendance | `attendance:list`, `attendance:create` | Present | None. `:read/update/delete` are cataloged but unused. |
| Permanent QR | `attendance-qr:read`, `attendance-qr:create` | **Proposed / absent** | Add two definitions after approval. |
| Workout Videos | `workout:list`, `:read`, `:update` | Present | None. `:create/delete` are cataloged but their routes are deferred. |
| Shop Plan Levels | `shop-level:list`, `:read` | Present | None. `:create/update/delete` are cataloged but not exposed because the Odoo model is not equivalent. |
| Dashboard | `dashboard:read` | **Proposed / absent** | Add one definition after approval. |

The proposed catalog additions are deliberately narrow:

| Permission | Description |
| --- | --- |
| `plan-duration:list` | List plan durations. |
| `plan-duration:create` | Create plan durations. |
| `plan-duration:update` | Update plan durations. |
| `plan-duration:delete` | Delete unreferenced plan durations. |
| `feedback:list` | List and filter client feedback. |
| `feedback:read` | Read an individual client-feedback record. |
| `attendance-qr:read` | Retrieve/reprint the active permanent gym QR. |
| `attendance-qr:create` | Create the first permanent gym QR credential. |
| `dashboard:read` | Read the Admin operational dashboard overview. |

There is no permission-name conflict found in the reference catalog. The apparent
duplicates of `member:list` and `member:read` inside the seed source are harmless
because the seed uses `upsert` by the unique name, but they are a maintenance smell and
should not be copied into a new provisioning list.

## Reviewable provisioning script template

The shared-backend owner should place the following reviewed TypeScript file in their
own repository, next to their Prisma client. It is intentionally documentation, not an
executable artifact in this Admin workspace. Its default is dry-run; `--apply` is
required for a write. It creates only missing `Permission` rows and never reads or
writes `RolePermission`, `UserRole`, Member, or credential data.

```ts
// scripts/provision-admin-v1-permissions.ts
import prisma from '../prisma/client';

const additions = [
  ['plan-duration:list', 'List plan durations'],
  ['plan-duration:create', 'Create plan durations'],
  ['plan-duration:update', 'Update plan durations'],
  ['plan-duration:delete', 'Delete unreferenced plan durations'],
  ['feedback:list', 'List and filter client feedback'],
  ['feedback:read', 'Read an individual client-feedback record'],
  ['attendance-qr:read', 'Retrieve/reprint the active permanent gym QR'],
  ['attendance-qr:create', 'Create the first permanent gym QR credential'],
  ['dashboard:read', 'Read the Admin operational dashboard overview'],
] as const;

const apply = process.argv.includes('--apply');
const expectedDatabase = process.env.RBAC_EXPECTED_DATABASE;
const expectedHost = process.env.RBAC_EXPECTED_HOST;
const confirmation = process.env.RBAC_PROVISION_CONFIRMATION;

if (!expectedDatabase || !expectedHost) {
  throw new Error('RBAC_EXPECTED_DATABASE and RBAC_EXPECTED_HOST are required.');
}
if (apply && confirmation !== 'APPROVED_ADMIN_RBAC_CATALOG_WRITE') {
  throw new Error('Refusing write without RBAC_PROVISION_CONFIRMATION.');
}

const [identity] = await prisma.$queryRaw<
  Array<{ database: string; server_host: string | null; server_port: number | null }>
>`SELECT current_database() AS database,
         inet_server_addr()::text AS server_host,
         inet_server_port() AS server_port`;

if (identity.database !== expectedDatabase || identity.server_host !== expectedHost) {
  throw new Error(`Target identity mismatch: database=${identity.database}; host=${identity.server_host ?? 'unavailable'}`);
}

const names = additions.map(([name]) => name);
const existing = await prisma.permission.findMany({
  where: { name: { in: names } }, select: { name: true, description: true, status: true },
});
const existingNames = new Set(existing.map((row) => row.name));
const missing = additions.filter(([name]) => !existingNames.has(name));

const report = { mode: apply ? 'apply' : 'dry-run', target: identity, existing, missing: missing.map(([name]) => name) };
if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  await tx.permission.createMany({
    data: missing.map(([name, description]) => ({ name, description })),
    skipDuplicates: true,
  });
  const roleLinks = await tx.rolePermission.count({ where: { permission: { name: { in: names } } } });
  if (roleLinks !== 0) throw new Error('Unexpected role assignment detected; rolling back.');
});
console.log(JSON.stringify({ ...report, created: missing.map(([name]) => name), roleAssignmentsCreated: 0 }, null, 2));
await prisma.$disconnect();
```

Implementation notes for the owner:

1. Run the dry-run first against the selected environment and record its JSON output in
   the change ticket. It performs a read-only target-identity check.
2. Set the expected database and host from the deployment inventory, not from a copied
   connection string. Never log `DATABASE_URL`, credentials, or secrets.
3. Apply only after two-person approval of the exact nine names/descriptions. Capture
   the output, deployed script checksum, operator, timestamp, and change ticket in the
   release audit system.
4. Verify after apply that all nine definitions are `ACTIVE` and that zero new
   `RolePermission`/`UserRole` rows exist. The supplied transaction will fail if it
   discovers an unexpected role link, but the post-check is still required.
5. Assign permissions to specifically named roles in a **separate** change with an
   approved role-to-permission matrix. Do not run the reference `roleSeeder` as part of
   this change.

`createMany(skipDuplicates: true)` protects concurrent catalog creation. It does not
mutate descriptions of existing names; a description mismatch must stop the run and be
resolved explicitly rather than silently overwriting an owner-managed definition.

## Role grants and rollback

Catalog creation is not authorization. After the catalog is accepted, owners must
approve a matrix such as “operations reader may receive `dashboard:read`” separately
from “attendance supervisor may receive `attendance-qr:read`.” Start least privilege:
do not grant QR creation to general Admin roles and do not bundle destructive duration
permissions with list access.

Role assignments should be idempotent inserts into `RolePermission` with the unique
`[roleId, permissionId]` constraint, performed by a separate reviewed script that
requires exact role names and permission names. It must output a before/after diff and
must never bulk-connect all catalog permissions. Permission changes take effect on the
next Admin API request because `PrismaAdminIdentityRepository` reloads active roles and
permissions per request.

Rollback order:

1. Disable the affected frontend feature flag/proxy route if needed.
2. Remove only the role links approved in that change, preserving the audit record.
3. Leave catalog definitions in place unless the owner confirms they were never used.
   Deleting a permission that has role links is forbidden. If deletion is approved, a
   guarded script must first prove no `RolePermission` row references it.

## Owner approvals required

- Acceptance of all nine permission names and descriptions.
- Exact roles and users permitted to receive each permission; no blanket `Admin` or
  `SuperAdmin` grant merely because a definition exists.
- Target database identity values and deployment-audit destination for the script.
- Whether role seeding is refactored before any future broad seed run; current behavior
  would otherwise escalate the new permissions to both seeded roles.
- Production session/proxy design from
  [admin-production-auth-proxy-design.md](./admin-production-auth-proxy-design.md).

## Recommended next implementation step

Have the shared-backend owner review this catalog change and create a separate,
least-privilege role-assignment proposal for a non-production environment. Do not run
the supplied apply mode until that review, database identity check, and deployment
change ticket are approved.
