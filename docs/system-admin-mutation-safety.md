# System Admin mutation safety foundation

This module is an internal safety layer for future Admin-management mutation
endpoints. No public mutation routes are registered yet, and the implementation uses
only the existing `User`, `Role`, `Permission`, `UserRole`, and `RolePermission`
tables.

## Invariant and protected role

An active System Admin is an `ACTIVE` User assigned to an `ACTIVE` role whose exact
name is the centralized `SYSTEM_ADMIN_ROLE_NAME`. A mutation that would remove or
deactivate the final such account is rejected. The protected role cannot be renamed,
deactivated, deleted, or recreated through ordinary role mutation policy. Assigned
normal roles cannot be hard-deleted; future retirement should set them `INACTIVE`.

Only an actor whose System Admin state is re-read in the mutation transaction may
assign or remove protected membership or modify the protected role's permission
relationships. The initial fail-closed policy prohibits System Admin self-removal and
self-deactivation even when another System Admin exists.

## Atomicity and concurrency

`RbacMutationService` performs complete validation and writes through a
transaction-scoped repository. `PrismaRbacMutationRepository` uses a PostgreSQL
`SERIALIZABLE` interactive transaction and retries Prisma `P2034` write conflicts up
to three attempts. With the Prisma PostgreSQL driver adapter, SQLSTATE `40001` may
surface directly as `DriverAdapterError` with `TransactionWriteConflict`; the same
narrowly identified condition is retried. The active-System-Admin count and mutation therefore
commit as one serializable unit rather than as a count followed by an unrelated write.

No PostgreSQL advisory lock or raw SQL is used. Serializable isolation is sufficient
for the current predicate-read/write operations and keeps the implementation inside
Prisma. If future workflows span systems or bypass this repository, that decision
must be revisited.

`rbac-mutation-concurrency.integration.test.ts` starts synchronized transactions only
against the fixed localhost integration database. It verifies competing membership
removals, competing deactivations, and a mixed removal/deactivation. In every case
exactly one operation commits, at least one real serialization retry is observed, the
losing operation is rejected after reloading current state, and one active System
Admin remains.

## Assignment behavior

- Missing Users, Roles, Permissions, or requested relationship rows return `NOT_FOUND`.
- Inactive roles and permissions cannot be assigned.
- Existing role and permission assignments are idempotent `changed: false` results.
- Database uniqueness and `createMany(..., skipDuplicates: true)` provide a second
  duplicate-assignment defense.
- Complete role replacement rejects duplicate or missing role IDs and validates every
  proposed role before deleting any existing assignment.
- Already inactive User deactivation is an idempotent `changed: false` result.

## Security audit logging

Future controllers must construct a request context containing the Pino request ID
and authenticated actor User ID, and use `PinoRbacSecurityAuditSink`. Events contain
the action, target type/ID, before/after identifiers where relevant, outcome, and a
stable rejection reason. They never contain passwords, hashes, JWTs, or secrets.

These logs are operational security telemetry only. They are not transactionally
coupled to PostgreSQL, are not a durable audit ledger, and do not replace a future
owner-approved audit table. A logging transport failure is not allowed to make an
already committed database mutation appear to have failed.
