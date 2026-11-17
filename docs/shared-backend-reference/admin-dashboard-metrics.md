# Admin Dashboard Metrics — Phase 3O

## Implemented endpoint

`GET /api/admin/v1/dashboard/overview`

The endpoint is database-backed and reports only canonical registered Member,
Attendance, and MemberRequest data. It returns no Member identity/contact records,
payment data, proof media, QR values, or entitlement claims.

## Authentication and permission

The route uses the existing active-Admin JWT resolver and database-backed RBAC. JWT
claims must contain `{ id, loginType: "admin" }`; the referenced `User` must be active
and its current role permissions are reloaded from PostgreSQL for every request.

The route requires **`dashboard:read`**. This is a proposed, fail-closed permission:
it is not present in the verified shared mobile permission seed catalog. The isolated
test creates it only when absent and assigns it only to a scoped synthetic role.

Before any shared deployment, the shared-backend owner must approve the permission,
add it to the authoritative catalog, and explicitly grant it to approved Admin roles.
No application fallback grants dashboard access.

## Verified metric definitions

| Response metric | Source | Definition |
| --- | --- | --- |
| `members.totalRegistered` | `Member` | All Member rows, independent of selected period and current status. |
| `members.activeRegistered` | `Member.status = ACTIVE` | Current registered-account status count, all time; **not** active paid memberships. |
| `members.inactiveRegistered` | `Member.status = INACTIVE` | Current registered-account status count, all time. |
| `members.newRegistered` | `Member.createdAt` | Member rows created inside the selected Yangon calendar interval. |
| `attendance.totalRecords` | `Attendance.createdAt` | Check-in event rows inside the selected interval; repeat visits count separately. |
| `attendance.distinctMembers` | `COUNT(DISTINCT Attendance.memberId)` | Unique Members with one or more attendance events inside the selected interval. |
| `membershipRequests.currentStatus.*` | `MemberRequest.status` | Current all-time row counts for canonical `PENDING`, `APPROVED`, and `REJECTED`; not historical status-at-period-end counts. |
| `membershipRequests.newSubmitted` | `MemberRequest.createdAt` | Request rows created inside the selected interval, regardless of current status. |
| `trends.points` | the three `createdAt` fields | Zero-filled selected-period bucket counts for registrations, attendance events, and request submissions. |

The evidence is `Member.createdAt`/`status`
(`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:250-281`),
`MemberRequest.status`/`createdAt` (`schema.prisma:208-245`), and canonical
`Attendance.createdAt` (`schema.prisma:1011-1027`). The dashboard uses attendance
`createdAt`, not the legacy Yangon `Attendance.date` string.

## Date and timezone contract

The dashboard timezone is fixed to `Asia/Yangon` (UTC+06:30; no DST). Database bounds
are UTC instants. Every selected calendar interval is `[local midnight, next local
midnight)`, so the start is inclusive and the end is exclusive.

```http
GET /api/admin/v1/dashboard/overview?month=2026-10
GET /api/admin/v1/dashboard/overview?from=2026-10-01&to=2026-10-31
GET /api/admin/v1/dashboard/overview?from=2026-01-01&to=2026-04-30&granularity=month
```

- `month`: strict `YYYY-MM`, one full Yangon month. Omitted period defaults to the
  current Yangon month.
- `from` and `to`: strict valid `YYYY-MM-DD` values, both required, and inclusive as
  user selections. Custom ranges may not exceed 366 days.
- `granularity`: `day` or `month`. The default is daily for custom ranges up to 62
  days and monthly for longer custom ranges. Daily trends are capped at 93 days. A
  monthly preset defaults to daily buckets.
- `month` cannot be combined with `from`/`to`; reversed, malformed, unknown, or
  excessive values return `422`.

For February 2026, `startsAt` is `2026-01-31T17:30:00.000Z` and `endsAt` is
`2026-02-28T17:30:00.000Z`. Leap days and month/year transitions are zero-filled
using the same Yangon calendar conversion as query aggregation.

## Response contract

```json
{
  "data": {
    "period": {
      "kind": "month",
      "timezone": "Asia/Yangon",
      "from": "2026-10-01",
      "to": "2026-10-31",
      "startsAt": "2026-09-30T17:30:00.000Z",
      "endsAt": "2026-10-31T17:30:00.000Z"
    },
    "members": {
      "totalRegistered": 0,
      "activeRegistered": 0,
      "inactiveRegistered": 0,
      "newRegistered": 0
    },
    "attendance": { "totalRecords": 0, "distinctMembers": 0 },
    "membershipRequests": {
      "currentStatus": { "pending": 0, "approved": 0, "rejected": 0 },
      "newSubmitted": 0
    },
    "trends": {
      "granularity": "day",
      "points": [{ "bucket": "2026-10-01", "registrations": 0, "attendance": 0, "membershipRequests": 0 }]
    }
  }
}
```

An authorized no-data period returns zeroes and fully zero-filled points, never `404`.
Current request-status totals are intentionally separate from period request submissions.

## Performance and query behavior

The repository uses Prisma `count`/`groupBy` for scalar totals and parameterized SQL
for `COUNT(DISTINCT attendance.memberId)` and Yangon bucket aggregation. It never
loads Member, Attendance, or MemberRequest rows into application memory. The only
dynamic SQL fragments are internally selected fixed day/month expressions; user input
is always parameterized.

The copied migration history declares `Attendance(memberId, createdAt)` but no dedicated
indexes on `Member.createdAt`, `Attendance.createdAt`, or `MemberRequest.createdAt/status`.
Before production scale, the shared database owner should inspect representative
`EXPLAIN (ANALYZE, BUFFERS)` output and approve timestamp-oriented indexes if needed.
No schema migration is created here.

## Tests executed

- Dashboard mocked router tests: **4 passed** — authentication, permission denial,
  strict validation, Yangon boundaries, leap day, daily/monthly zero filling, and
  no-data response safety.
- Scoped isolated PostgreSQL integration tests: **2 passed** — exact half-open Yangon
  February-boundary registration/attendance/request aggregates, distinct attendees,
  zero-filled points, inactive Admin denial, and database permission removal.

The integration test uses uniquely named synthetic users, roles, permissions, member
types, durations, plans, Members, requests, and attendance rows. It deletes only those
known IDs afterwards; it does not truncate/reset retained Stage 3I fixtures.

## Metrics intentionally unavailable

- revenue, paid revenue, refunds, or accounting totals;
- active paid subscriptions, active memberships, expiry/renewal/churn;
- first membership activation or existing/new membership counts;
- membership-plan distribution as active entitlements;
- historical request status-at-period-end;
- Odoo mock member-type distribution and recent-detail tables.

The schema has no canonical membership entitlement/effective/expiry history. A
`Member.memberTypeId`, `MemberRequest.status`, or `Payment` row must not be treated as
proof of an active paid membership. Payment/accounting semantics and membership
approval remain separately blocked.

## Frontend integration guidance

The current DashboardPage is mock-only and remains unchanged. A future frontend slice
should call `/node-api/api/admin/v1/dashboard/overview` with the in-memory Node Admin
bearer token, render the explicit registered-account/request/attendance labels, respect
`trends.granularity`, and retain an all-zero empty state. It must omit mock revenue,
active-membership, plan-distribution, and recent-detail widgets until canonical
contracts exist. Handle `401` by clearing the Node session and `403` as a permission
error without falling back to Odoo credentials.
