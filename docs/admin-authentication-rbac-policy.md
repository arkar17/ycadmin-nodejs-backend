# Admin authentication and RBAC policy

This policy deliberately uses the current authoritative `User`, `Role`, `Permission`,
`UserRole`, and `RolePermission` models without schema changes.

## Login eligibility

Admin login requires:

1. a valid password for an active `User`; and
2. at least one currently active assigned `Role`.

Missing users, incorrect passwords, inactive users, users with no roles, and users
whose only roles are inactive receive the same generic `401 INVALID_CREDENTIALS`.

## Request identity

JWTs remain identity-only and contain `{ id, loginType: "admin" }` plus standard
issued/expiry claims. Roles, permissions, status, and System Admin state are never
trusted from a token. Every protected request reloads the active User, active Roles,
and active Permissions from PostgreSQL.

Issuer/audience claims remain a documented future hardening step because adding them
now would intentionally reject currently compatible tokens and clients.

## System Admin

`SYSTEM_ADMIN_ROLE_NAME` is centralized in `src/modules/auth/admin-access-policy.ts`
and has the exact compatibility value `SuperAdmin`. A user is a System Admin only when
the user and that assigned role are both currently active.

System Admin bypasses endpoint permission guards. It does not bypass authentication,
active-user checks, active-role checks, or JWT validation.

Future Admin-management APIs must enforce these application-level invariants:

- `SuperAdmin` cannot be renamed, deactivated, or deleted through normal role APIs;
- normal Admins cannot assign or remove `SuperAdmin`;
- only a current System Admin may grant or remove `SuperAdmin`;
- removing or deactivating the last active System Admin must be rejected;
- last-System-Admin checks must be transactional and concurrency-safe.

## Normal Admin permissions

Normal Admin permissions are the deduplicated union of active Permissions reached
through all active Roles. Guards preserve all-required semantics. Inactive roles and
inactive permissions contribute nothing. Role and permission changes take effect on
the next protected request without issuing another JWT.

## Error boundary

- Invalid/expired tokens and no-longer-eligible identities return `401`.
- Authenticated normal Admins missing a route permission return `403`.
- Repository/database failures are propagated to the central infrastructure error
  handler and are never converted into `401 INVALID_TOKEN`.
