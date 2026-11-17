# Feedback API implementation blocker

## Investigation result

The shared schema contains a verified feedback model, but the downloaded mobile-backend reference does **not** establish an Admin authorization permission for reading it. This prevents safe implementation of `GET /api/admin/v1/feedback` and `GET /api/admin/v1/feedback/:id` under the Admin API's mandatory database-backed RBAC policy.

## Confirmed data model

`ClientFeedback` is the authoritative model:

- `id`: integer primary key.
- `name`: required text; this is the submitted feedback message.
- `memberId`: required foreign key to `Member` with cascade deletion.
- `createdAt`: creation timestamp suitable for a submitted-date filter.
- `updatedAt`: Prisma-managed update timestamp.

Sources:

- Local synchronized schema: `prisma/schema.prisma:1387-1395`.
- Read-only reference schema: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:1387-1395`.
- The reference migration creates the same table and foreign key: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/migrations/20260822100000_add_client_feedback/migration.sql:1-15`.

The available schema facts would support a narrow DTO of `{ id, feedbackMessage, member: { id, name, clientCode }, createdAt }` and filters over related `Member.name`, `Member.code`, and an owner-defined calendar-date range on `ClientFeedback.createdAt`. They do not establish authorization or the date-boundary timezone.

## Permission blocker

The reference has only a **member-side create** endpoint:

- `POST /client.feedback/create`, protected by member JWT authentication: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/member/v1/support/client-feedback.route.ts:9-15`.
- It creates `ClientFeedback` from the current Member and has no list/detail behavior: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/controllers/member/v1/support/client-feedback.controller.ts:27-85`.

There is no Admin feedback route, controller, service, scope, resource, or read permission in the downloaded reference. A source-wide search of the reference TypeScript files found only the member-side creation implementation. The reference permission seed list ends at line 649 and contains no feedback permission: `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts:1-649`.

Therefore, names such as `feedback:list`, `feedback:read`, `client-feedback:list`, or reuse of `member:list` would be invented permissions and would violate the required RBAC compatibility rule.

## Safe next step

Obtain an owner-approved, shared permission decision and assignment strategy for feedback reads (including whether list and detail share one permission). After that decision is reflected in the shared backend's permission catalog, implement the two read-only routes with:

1. `createAuthenticateAdmin` and the confirmed permission guard.
2. An approved timezone/date-boundary policy, then Zod validation for name, client code, ISO `YYYY-MM-DD` date, bounded limit, offset, and positive detail ID.
3. A narrow Prisma `ClientFeedback` repository selecting only feedback message, timestamps, and the related Member's ID/name/code.
4. Mocked and isolated PostgreSQL tests for filtering, pagination, 401/403, permission revocation, inactive Admins, 404, and sensitive-field exclusion.
