# Gradual Odoo-to-Node Admin Migration Rollout — Phase 3Q

## First slice: Plan Durations

Plan Durations is the recommended first production-facing slice because its four Node
operations are implemented, have direct `name`/`value` mapping, do not depend on media,
payment entitlement, or the shared attendance migration, and enforce references before
mutation. This does **not** make it automatically production-ready: its four proposed
permissions, production Node session/proxy, and a React REST adapter remain prerequisites.

The existing Odoo `/plan-durations` page and JSON-RPC endpoints remain live throughout
the rollout. The Node page must initially have a distinct route or a server-controlled
feature gate; do not replace the existing path for every user at once.

## Preconditions and owner approvals

1. Approve the four `plan-duration:*` catalog definitions in
   [admin-rbac-provisioning-plan.md](./admin-rbac-provisioning-plan.md), then grant
   them explicitly to a least-privilege pilot role. Confirm no broad role seeder ran.
2. Approve and implement the production Node session/proxy design in
   [admin-production-auth-proxy-design.md](./admin-production-auth-proxy-design.md).
   Until then, the current memory-only local login is not a production migration path.
3. Confirm the shared database schema and migration history used by the Node deployment
   are the owner-approved version; no migration is required for Plan Durations itself.
4. Implement a frontend adapter that converts the React page from Odoo JSON-RPC to the
   REST requests below, without changing the Odoo page until the gate is enabled:

| Operation | Node contract | Expected failure handling |
| --- | --- | --- |
| List | `GET /api/admin/v1/plan-durations?search=&limit=&offset=` | `401` sign in; `403` no permission; `422` invalid query. |
| Create | `POST /api/admin/v1/plan-durations` JSON body | `409` duplicate duration/name as returned by API. |
| Update | `PATCH /api/admin/v1/plan-durations/:id` JSON body | `404` missing; `409 DURATION_IN_USE` where applicable. |
| Delete | `DELETE /api/admin/v1/plan-durations/:id` | `409 DURATION_IN_USE`; do not offer a misleading forced delete. |

5. Run API contract and browser tests in an isolated/pre-production environment using
   synthetic records. Confirm permission denial, expired Node session, pagination,
   duplicate handling, referenced duration protection, request IDs, and rollback UI.

## Controlled enablement

1. Deploy the Node API behind the exact `/api/admin/v1/` proxy route but keep the Node
   Plan Durations UI disabled by default.
2. Enable it only for a named pilot role or allowlisted test accounts through a
   server-controlled release configuration. A React build-time flag may hide UI, but is
   not authorization; backend RBAC remains mandatory.
3. Present the explicit Node Admin sign-in for the Node page while Odoo pages retain
   their current session. Explain that the two sessions are independent during the
   transition; never carry an Odoo cookie into a Node authorization header.
4. For the pilot, direct users to a separate Node route (for example
   `/node/plan-durations`) while retaining legacy `/plan-durations`. Only after a
   successful cohort can the canonical navigation target be switched.
5. Keep each user on one writer UI per task. Both systems use the shared database, but
   this avoids operator confusion and makes incident analysis tractable. Database
   reference protection remains the final integrity control.

## Observability and stop conditions

Before enabling the pilot, create dashboards/alerts for:

- login success/failure/throttle rates and 401/403 ratios by route;
- 409 conflict counts (`DURATION_IN_USE` and duplicates), 422 validation failures, 5xx
  rates, latency, and Node upstream health;
- request ID correlation across proxy and Node structured logs; and
- per-route adoption and rollback selections, without logging secrets or personal data.

Immediately disable the feature gate and return affected users to Odoo if authentication
misrouting, unexplained authorization denials, data-shape mismatch, reference-protection
failure, or error-rate threshold occurs. Preserve logs and the request IDs needed for
investigation. Do not delete or replay shared database records as a rollback action.

## Rollback

Rollback is deliberately non-destructive:

1. Disable the Node Plan Durations navigation/feature gate for the affected cohort.
2. Retain the Node API deployment long enough to serve diagnostics or drain it from the
   proxy; leave Odoo API routing untouched.
3. Route users back to the Odoo page. Since no Plan Duration schema migration or data
   transformation is introduced, no database rollback is required.
4. Revoke the pilot role’s four grants only if authorization itself is implicated;
   retain catalog definitions unless the owner approves a guarded removal.
5. Publish incident findings before a renewed cohort.

## Graduation criteria and next pages

Promote the canonical Plan Durations navigation only after a defined pilot interval
shows stable health, correct Odoo/Node record visibility, no unauthorized access, tested
rollback, and owner sign-off. Reassess each subsequent screen independently—do not infer
readiness from this slice.

Recommended order after Plan Durations:

1. Read-only Member Directory, Feedback, and Dashboard after their missing permissions
   and Node session/proxy are provisioned. Dashboard UI needs a new adapter and must not
   restore unsupported revenue/entitlement metrics.
2. Safe Bank Information and Member Plan subsets after REST adapters and media-field
   omissions are presented honestly in the UI.
3. Workout metadata/listing only after reference-data and media-display behavior are
   confirmed; defer video create/delete.
4. Attendance only after the shared mobile backend adopts the reviewed migration,
   rolling-window trigger, permanent QR credential handling, and secret management.
5. Membership-request decisions only after payment, entitlement, expiry, audit, and
   concurrency rules receive product-owner approval.
6. Odoo Plan Level Type CRUD remains blocked until a real Prisma model and lifecycle are
   approved; neither MemberType nor ShopLevel is a replacement.

## Migration exit criteria

A screen is eligible to retire its Odoo path only when its Node API contracts cover every
essential operation, mapped fields are authoritative, permissions are cataloged and
granted explicitly, media/storage and mobile dependencies are approved, monitoring and
rollback are tested, and the production session architecture is in use. The coverage
audit currently identifies no production screen meeting all of these criteria without
follow-up work.

## Recommended next implementation step

Obtain owner approval for the nine permission definitions and the production
session/proxy design, then have the shared-backend owner dry-run the reviewable catalog
provisioning script in a non-production environment. After explicit pilot-role grants,
the next code phase is the narrowly scoped React Plan Durations REST adapter and its
feature-gated Node-session route.
