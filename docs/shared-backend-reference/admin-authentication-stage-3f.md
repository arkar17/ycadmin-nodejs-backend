# Admin authentication — Phase 3G Stage 3F

## Verified shared compatibility

The copied mobile backend’s Admin sign-in is `POST /api/admin/v1/auth/sign-in` (`routes/admin/v1/auth.route.ts:8-12`). Its controller finds an active `User` by email/username, verifies `User.password`, and signs `{ id, loginType: "admin" }` (`app/controllers/admin/v1/auth.controller.ts:29-71`). The helper uses `bcrypt.compareSync` against bcrypt cost-10 hashes and `jsonwebtoken.sign` with the configured secret and a 30-day default (`app/helpers/helper.ts:11-27`).

The isolated Admin API now uses the same credential format and claim contract, with asynchronous bcrypt 6 verification and an explicit HS256 algorithm restriction. It does not copy the reference controller’s `SuperAdmin`-only login condition: the verified shared schema represents Admin accounts as active `User` records with roles/permissions, and protected API authorization rehydrates those active assignments on every request.

## Local endpoint contract

```http
POST /api/admin/v1/auth/login
Content-Type: application/json

{ "emailOrUsername": "admin", "password": "…" }
```

Success (`200`):

```json
{
  "data": {
    "accessToken": "<JWT>",
    "tokenType": "Bearer",
    "expiresAt": "2026-…Z",
    "user": { "id": 1, "name": "…", "username": "admin" }
  }
}
```

Invalid, nonexistent, and inactive accounts all receive the same `401 INVALID_CREDENTIALS` envelope. Invalid body fields receive the established `422 VALIDATION_ERROR` envelope. The response has no password, hash, roles, or permissions. Existing protected routes continue to validate the issued token as HS256, require `loginType === "admin"`, require an active current User, and resolve current active permissions from PostgreSQL.

The default `JWT_EXPIRES_IN=30d` matches the verified shared Admin issuer. It is validated as a positive unit duration and may be reduced only through a coordinated issuer/client/key-rotation decision. Tokens carry an `exp` claim and protected routes reject expired or forged values.

## Session lifecycle

There is deliberately no logout route or revocation table: the verified shared contract has no token/session storage. Browser logout must clear the in-memory token only; it cannot invalidate an already issued JWT. Account deactivation and permission removal take effect on the next protected request because the Admin identity/RBAC query is database-backed.

JWT secret rotation invalidates tokens signed with an old symmetric key unless a reviewed multi-key verification strategy is adopted. Production requires secrets from the approved secret manager, not `.env` files, source control, or browser configuration.

## Local frontend handoff

The frontend should send its username/password to this endpoint over the Vite local proxy, then call `setNodeAdminAccessToken(response.data.accessToken)` from its existing memory-only `nodeAdminSession.ts`. It must call `clearNodeAdminAccessToken()` on logout and must not persist the token in localStorage, sessionStorage, cookies, URLs, or analytics. Existing Odoo-backed modules continue using their existing Odoo login/cookie client until migrated separately.

## Rate limiting and production requirements

The route uses an in-memory per-IP guard of 10 attempts per 15 minutes. It is intentionally suitable only for local or single-process deployment; process restart clears it and multiple instances do not share counters. Before production or horizontal scaling, enforce an equivalent rate limit at the trusted ingress or use an approved shared rate-limit store. Configure Express proxy trust only for known proxy hops, so client IP selection cannot be spoofed.

No credential fields or hashes are logged by this route. The route does not create accounts, reset passwords, grant roles, or mutate permissions.
