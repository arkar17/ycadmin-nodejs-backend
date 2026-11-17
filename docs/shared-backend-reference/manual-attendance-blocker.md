# Manual Attendance blocker — implementation deferred

## Verified facts

`Attendance` has required `memberId`, legacy `date: String`, nullable `qrToken`, optional `createdById`, `createdAt`, and `updatedAt` (`prisma/schema.prisma:1008-1023`). A null `qrToken` can represent a record created without a QR token, and `createdById` is an existing audit relation that the legacy Admin service populates. Neither field is a declared attendance-source enum or a cross-client duplicate-policy mechanism.

The mobile QR workflow creates attendance with the submitted token, records the server `createdAt`, and prevents only a check-in created within the previous hour (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/services/member/v1/fitness/attendance.service.ts:48-86`). It does not use a Myanmar-calendar-day duplicate rule, a transaction lock shared with Admin writes, or a database uniqueness constraint.

The latest shared migration explicitly removes the per-member/day unique index and retains only the non-unique `[memberId, createdAt]` index (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/migrations/20260903120000_attendance_allow_multi_checkin/migration.sql:1-8`). The reference audit independently records this intentional multi-check-in change (`docs/shared-backend-reference/final-backend-integration-audit.md:99-105`).

The authenticated Admin permission name is confirmed as `attendance:create` in the copied permission catalog and Admin route (`prisma/seeds/permission.seeder.ts:585-604`; `routes/admin/v1/attendance.route.ts:10-27`). The reference legacy Admin create handler writes `createdById` but checks only the mutable legacy string `date` (`app/services/admin/v1/attendance.service.ts:154-176`), so it is not safe to reuse as policy evidence.

## Why `POST /api/admin/v1/attendance/manual` is not enabled

The requested endpoint must share a duplicate policy with Flutter and must prevent simultaneous duplicates. No approved once-per-day policy exists, and implementing one only for Admin would conflict with the mobile one-hour policy. Conversely, implementing a one-hour policy would not meet the requested Yangon calendar-day duplicate handling.

There is no schema-backed uniqueness rule and the mobile QR write path does not participate in an Admin-only transaction or advisory lock. Therefore a transaction or lock added only here cannot prevent a simultaneous mobile QR write. Adding a unique index, source column, or shared locking protocol would require a shared schema/mobile-backend decision and migration, which are out of scope.

`createdById` may safely retain the verified Admin audit actor if a future shared policy authorizes manual creation, but it cannot by itself make source or duplicate semantics unambiguous. No QR credential, fake source value, or artificial `date` value will be written.

## Required decisions before implementation

1. Approve one canonical cross-client duplicate policy: one calendar day, one hour, or multiple check-ins with an explicit limit.
2. Specify whether `Attendance.createdAt` is the authoritative event time for both QR and manual entries, and whether Asia/Yangon is the canonical day boundary.
3. Adopt shared database-backed enforcement that both mobile and Admin writes use: a unique key/index where applicable, or a shared transactional/advisory-lock service protocol.
4. Approve an explicit source/audit contract if reports must distinguish manual from QR attendance. This likely requires schema ownership work; inferring source from nullable `qrToken` is not a durable contract.
5. Confirm eligible-member rules. The schema confirms only Member existence/status; membership payment, plan, and entitlement are not a verified attendance gate.
