# YC Fitness Admin API Coverage Audit — Phase 3P

## Scope and method

This is a static, read-only comparison of the React Admin source, the registered
`/api/admin/v1` router, and the downloaded mobile-backend reference. No application
was run, no database was contacted, and no code/schema/configuration was changed.

The detailed operation-level evidence is in
[admin-api-migration-matrix.md](./admin-api-migration-matrix.md).

## Reachable frontend inventory

| Route/screen | Reachability | Current backend dependency |
| --- | --- | --- |
| `/login` | Production/local | Odoo JSON-RPC `/admin/login` and `/admin/logout`; cookie request plus a localStorage boolean. |
| `/users` | Production/local | Odoo `/members/list`; Member Plan dropdown also calls Odoo `/member_plan/list`. |
| `/members`, `/members/:id` | Production/local | Odoo membership-request list/detail/approve/reject plus Odoo plan lookup. |
| `/member-plans` | Production/local | Odoo member-plan CRUD, duration lookup, and plan-level-type lookup. |
| `/member-type-levels` | Production/local | Odoo plan-level-type CRUD. |
| `/plan-durations` | Production/local | Odoo duration CRUD. |
| `/bank-information` | Production/local | Odoo bank-information CRUD and multipart image handling. |
| `/feedback` | Production/local | Odoo feedback list/detail. |
| `/workout-videos` | Production/local | Odoo workout CRUD, multipart video upload, and plan lookup. |
| `/attendance`, `/attendance/manual-create`, `/attendance/qr` | **DEV only** | Node Admin login/session and Node attendance APIs. |
| `/node-admin-login` | **DEV only** | Node `POST /api/admin/v1/auth/login`. |
| `DashboardPage.tsx` | Not routed | Mock `demoData`; no current route or API client. |
| `/settings` | Redirect only | Redirects to `/users`; no settings operation. |

The source of truth is `/Users/arkar/Desktop/admin-site/src/App.tsx:20-47` and
`src/components/Sidebar.tsx:12-24`. The Dashboard component exists but is not imported
by the router. Node attendance is intentionally hidden outside `import.meta.env.DEV`.

## Actual registered Node Admin API surface

| Registered path | Methods | Status |
| --- | --- | --- |
| `/health` | `GET` | Public operational health check; no database access. |
| `/auth/login` | `POST` | Implemented; active User credentials issue the verified Admin JWT contract. |
| `/dashboard/overview` | `GET` | Implemented; protected by proposed, currently unprovisioned `dashboard:read`. |
| `/members` | `GET` | Read-only directory; `member:list`; current-plan filtering is rejected. |
| `/attendance` | `GET`, `POST /manual` | Implemented in isolated foundation; list requires `attendance:list`, manual requires `attendance:create`. |
| `/attendance/qr` | `GET`, `POST` | Implemented locally; requires proposed `attendance-qr:read/create` plus key configuration. |
| `/membership-requests` | `GET`, `GET /:id`, `POST /:id/approve`, `POST /:id/reject` | Safe reads plus transactional decisions; list/read/update permissions. |
| `/feedback` | `GET`, `GET /:id` | Read-only; proposed `feedback:list/read`. |
| `/plan-durations` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | Complete safe subset; proposed duration permissions. |
| `/member-types` | `GET` | Read-only reference data; not Odoo plan-level types. |
| `/shop-plan-levels` | `GET`, `GET /:id` | Read-only ShopLevel catalogue; not Odoo plan-level types. |
| `/member-plans` | `GET`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` | Verified safe subset, with reference checks. |
| `/bank-information` | `GET`, `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` | Verified safe subset; no image support. |
| `/workout-videos` | `GET`, `GET /:id`, `PATCH /:id` | Read/detail plus restricted metadata/status update only. |

This was verified directly from
`/Users/arkar/Desktop/yc-fitness-admin-api/src/routes/admin-v1.ts` and each router.
There are no feature HTTP routers implemented but intentionally unregistered. Placeholder
module barrels (`qr`, and several older module indexes) are not endpoints.

## Coverage totals

The audit counts **40 distinct user-visible operations** defined by current reachable
screens or their local Node counterparts:

- **6 backend-complete operations:** Plan Duration list/create/update/delete plus
  Membership Request approve/reject. They still need their respective approved
  permission provisioning and a frontend REST adapter before production use.
- **28 partially supported operations:** an equivalent Node endpoint or local UI exists,
  but an Odoo-to-REST adapter, permission provisioning, contract field changes, shared
  migration/mobile rollout, or production session/proxy work remains.
- **6 blocked operations:** Odoo plan-level-type
  CRUD; workout create/delete. Each lacks a safe authoritative data/business contract.

“Backend-complete” does not mean deployed or frontend-migrated. No current production
React screen is READY to switch without an approved frontend migration change.

## Cross-cutting blockers

| Classification | Finding | Affected scope |
| --- | --- | --- |
| Frontend integration only | Existing Odoo JSON-RPC clients, snake_case DTOs, multipart form code, and Odoo status vocabulary must be replaced/adapted to REST response envelopes. | Every Odoo-backed page. |
| Authentication/session architecture | The primary layout trusts an Odoo login flow and localStorage flag. Node JWT is memory-only and local-dev routes are isolated; no production Node session/navigation strategy exists. | All production Node migration work. |
| Permission provisioning | `plan-duration:*`, `feedback:*`, `attendance-qr:*`, and `dashboard:read` are not in the copied shared catalog. Existing permissions also require explicit role assignment. | Durations, feedback, QR, dashboard, and all protected APIs. |
| Missing shared business rule | No canonical membership entitlement, activation/expiry, payment prerequisite, retry, or decision state machine. | Member-request approve/reject and membership dashboard metrics. |
| Shared Prisma migration required | Attendance source/credential/trigger local migrations must be re-authored/adopted by the shared mobile owner; membership entitlement may require new shared schema. | Manual/QR attendance production rollout; request decisions. |
| Mobile backend dependency | Flutter QR endpoint still uses its old verification/storage behavior; mobile workflows consume active ShopLevel, plans, workouts, payments. | QR/attendance, shop level mutations, plans, workouts. |
| Media storage dependency | No approved private upload/signed-read/retention policy for plan images, bank images, payment proofs, or workout media. | Bank image, request proof, member-plan image, workout create/media edits. |
| Deployment/infrastructure | Vite `/node-api` proxy is local only; production needs reverse proxy/CORS, secret manager, isolated migration ownership, RBAC provisioning, and operational monitoring. | Every Node-backed production screen. |

## Highest-priority remaining work

1. **Approve/provision the permission catalog and role assignments** for the already
   implemented routes. This is a prerequisite for safe shared-environment access.
2. **Adopt the shared attendance migration and mobile QR patch** through the mobile
   backend owner’s release process, including secret-manager keys and cross-writer
   tests. Do not expose local-only attendance routes as production-ready first.
3. **Resolve membership approval/entitlement ownership** before implementing the two
   request-decision endpoints or membership KPIs.
4. **Choose the Odoo plan-level product model.** `level_count` has no verified Prisma
   field; neither `MemberType` nor `ShopLevel` is a safe silent substitute.
5. **Approve media architecture** before workout creation, video replacement/deletion,
   bank images, plan images, and payment-proof viewing.
6. **Migrate the low-risk frontend slices** after permissions are available: Plan
   Durations first, then read-only feedback/member directory/dashboard and safe bank/
   member-plan adapters.

## Recommended next phase

**Phase 3Q — Shared RBAC provisioning and production session/proxy design.**

Produce and obtain owner approval for the shared permission additions/role grants,
production Node Admin authentication/session routing, Vite replacement strategy, and
reverse-proxy/CORS/secret-manager requirements. Then migrate the Plan Durations React
client to REST as the first end-to-end low-risk screen. It has complete Node CRUD,
minimal field mismatch, and no media or entitlement dependency.

Only after that should the project take the shared attendance rollout and membership
decision contracts into a shared-backend release. Do not start broad frontend migration
before those owner decisions are in place.
