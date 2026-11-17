# Production Admin Authentication and Reverse-Proxy Design — Phase 3Q

## Current verified state

The Admin API login route issues an HS256 JWT with `{ id, loginType: 'admin' }`, an
`expiresAt`, and a Bearer token response. It authenticates only an active shared `User`
and uses bcrypt comparison even for unknown accounts. Every protected request verifies
the token, requires `loginType === 'admin'`, then reloads active roles and permissions
from PostgreSQL. A valid Member token therefore cannot authorize an Admin route even if
an ID overlaps. Sources: `src/modules/auth/admin-login.service.ts`,
`src/middleware/authenticate.ts`, and `src/modules/auth/admin-identity.repository.ts`.

The current default JWT lifetime is `30d`; local login rate limiting is process-local
(10 attempts per 15 minutes by apparent client IP). There is no refresh endpoint,
server-side session store, token deny-list, or server logout. The current frontend keeps
the Node JWT in a module variable only and sends it as a Bearer header with
`credentials: 'omit'`; refresh clears it. Odoo remains separate: it uses its own API,
cookie-capable requests, and a localStorage UI flag. The production React routes remain
Odoo-backed; Node attendance routes are deliberately development-only.

No production Nginx, ingress, or deployment configuration was present in the inspected
projects. The only proxy evidence is the local Vite `/node-api` → `localhost:3000`
bridge and `/odoo-api` → `https://odoo.yc.fitness/v2/api` bridge. The configuration
below is a target design, not a claim about deployed infrastructure.

## Recommendation: temporary dual login, same-origin Node session

Do **not** treat an Odoo cookie, Odoo localStorage flag, or Odoo login as Node Admin
authorization. Do not silently exchange an Odoo credential for a Node token. The safe
transitional model is two visibly separate sessions:

| Phase | Odoo pages | Migrated Node pages |
| --- | --- | --- |
| Initial production slice | Existing Odoo login/session unchanged | Explicit “Node Admin sign-in”; Node session is independently verified against shared `User`/RBAC. |
| Migration period | Odoo remains authoritative for legacy pages | Node session is used only for pages deliberately switched behind a server-controlled feature flag. |
| Eventual consolidation | Decide only after a shared identity/credential/SSO design is approved | Replace dual login through a formal identity migration, not cookie trust. |

For production UX, evolve the current memory-only Bearer implementation to a
same-origin, server-managed Node session. Keep the existing Bearer flow available only
where an explicitly approved non-browser client requires it.

### Required future Node session contract

This is a design requiring implementation approval, not a change made in this phase.

- On successful Node login, create an opaque, random session identifier in an approved
  shared store (Redis or an explicitly designed session table), bound to User ID,
  issuance/expiry, credential generation, and optional device metadata. Store only a
  hash of the identifier server-side.
- Send it in a distinct `HttpOnly; Secure; SameSite=Lax; Path=/api/admin/v1` cookie
  (for example `yc_node_admin_sid`). Do not reuse an Odoo cookie name.
- Use a short idle/absolute lifetime chosen by the owner; replace the current 30-day
  browser JWT default. Rotate the session identifier on login and renewal. Do not store
  access tokens in localStorage, sessionStorage, URLs, telemetry, or error reports.
- Add `GET /api/admin/v1/auth/session` and an explicit Node logout endpoint that
  revokes the server session and clears only the Node cookie. A browser refresh can then
  restore a valid Node session without exposing a JS-readable token.
- Resolve active User/Roles/Permissions on every privileged request (or cache only with
  bounded invalidation). Current API behavior already rehydrates them per request;
  preserve that property so account disablement and permission revocation are effective
  immediately.
- Require CSRF protection for cookie-authenticated state changes: same-origin Origin
  and Host validation plus a per-session CSRF token sent in a custom header. `SameSite`
  reduces risk but is not the only control. Read-only GET endpoints still require the
  Node session.
- Rate-limit login at the proxy/shared rate-limit store by IP and normalized account
  identifier. Preserve generic credential errors to avoid account enumeration. The
  current in-process limiter is insufficient behind multiple Node instances.
- Log request ID, account ID, outcome, and permission decision category—never password,
  JWT, session value, QR payload, or encryption/HMAC material. Alert on throttling and
  privilege-denial spikes.

Immediate account lockout, credential reset, logout-all-devices, and refresh-token
family reuse detection are not currently supported by the verified schema. They require
an owner-approved session/revocation design. Until then, security-sensitive credential
changes must revoke server sessions via the chosen shared store.

## Nginx / ingress routing plan

Prefer a single HTTPS origin such as `https://admin.example.invalid` for the React
application and Node API. This avoids CORS for browser traffic and lets the proxy
enforce consistent TLS, request-ID, body-size, and rate limits. Route precedence must
be exact:

1. `^~ /api/admin/v1/` → Node Admin upstream only.
2. Existing `/odoo-api/` → existing Odoo upstream/rewrite only.
3. Static React assets → immutable cache policy.
4. Remaining browser routes → `index.html` SPA fallback.

Illustrative, owner-adapted configuration (do not apply verbatim):

```nginx
upstream yc_admin_node { server 127.0.0.1:3000; keepalive 16; }

server {
  listen 443 ssl http2;
  server_name admin.example.invalid;
  # TLS certificates, HSTS, CSP, and static root are deployment-managed.

  location ^~ /api/admin/v1/ {
    client_max_body_size 1m;
    limit_req zone=admin_api burst=30 nodelay;
    proxy_pass http://yc_admin_node;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
    proxy_read_timeout 30s;
  }

  location = /api/admin/v1/auth/login {
    limit_req zone=admin_login burst=5 nodelay;
    proxy_pass http://yc_admin_node;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
  }

  location ^~ /odoo-api/ {
    # Preserve the existing upstream/rewrite and Odoo-specific limits exactly.
    proxy_pass https://odoo_upstream;
  }

  location / { try_files $uri $uri/ /index.html; }
}
```

Implementation implications:

- Configure Express `trust proxy` to the specific internal proxy CIDR/load balancer,
  never an unrestricted `true`. This is required before the backend can safely use
  forwarded protocol and client IP for security/rate limiting.
- Keep Node and Odoo cookie names distinct. Scope the Node session cookie to
  `/api/admin/v1`; preserve Odoo cookie behavior unchanged. Do not forward Odoo cookies
  as an authorization assertion to Node.
- With this same-origin plan, do not enable broad CORS. If a separate frontend origin is
  later unavoidable, allow only the exact HTTPS origin, allow credentials only for the
  cookie session, enumerate methods/headers, and validate Origin on mutations—never use
  `*` with credentials.
- Terminate TLS at a managed proxy, redirect HTTP to HTTPS, enable HSTS after rollback
  implications are understood, and set a restrictive CSP for the SPA. Keep service
  secrets in a managed secret store, not Vite variables or Nginx source.
- `GET /api/admin/v1/health` is the unauthenticated liveness check and intentionally
  does not use PostgreSQL. Add a separately protected/operational readiness check only
  if the deployment owner defines its database semantics.
- Maintain body-size limits suitable for the current JSON-only Node API. Do not inherit
  a broad multipart limit merely because Odoo has legacy media endpoints.

## Deployment, zero-downtime, and rollback

Deploy the Node API as an independently versioned upstream. Before receiving traffic,
validate configuration and secrets, run the application health check, and confirm that
the shared schema/client version matches the reviewed release. Shift a small, allowlisted
cohort to Node-backed pages using a server-controlled feature flag; do not expose a new
Node API path to all UI users based only on a client-side variable.

Rollback is route/UI selection: stop directing the cohort to the Node page, drain the
Node upstream, and keep Odoo paths intact. Do not “roll back” user data by deleting
shared-database rows created through a verified Node mutation. The first slice (Plan
Durations) needs only compatible catalog data, so no schema rollback is expected.

## Security risks and approvals

| Risk | Required mitigation / decision |
| --- | --- |
| Long-lived JWT theft | Approve short-lived, HttpOnly server session with revocation; retain memory-only Bearer only for local development until then. |
| Odoo-to-Node privilege confusion | Explicit dual login; no Odoo-cookie trust or automatic credential mapping. |
| Shared role seed privilege escalation | Do not run the all-permissions role seeder after adding permissions; separate catalog and role grants. |
| Proxy IP spoofing | Restricted `trust proxy`, controlled ingress, and proxy-supplied request IDs. |
| CSRF for cookie sessions | Origin/Host checks and CSRF header on mutations. |
| QR/media secret disclosure | Secret manager; no logs/browser persistence; separately provision restricted QR permissions. |
| Brute force / distributed login attacks | Proxy/shared-store rate limiting and monitoring; current in-memory limiter is not sufficient. |

Owner approvals: chosen session store and lifetimes, logout/revocation semantics, proxy
hostnames/TLS/CIDRs, rate-limit thresholds, CSP/CSRF policy, secret-manager integration,
and the permission-role matrix. No production configuration should change before all are
approved.
