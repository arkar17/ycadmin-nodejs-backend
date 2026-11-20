# Browser Admin Authentication v1

## Transport contract

The Admin API supports two transports that resolve through the same JWT validation
and database-backed Admin identity lookup:

1. Existing non-browser/development clients send `Authorization: Bearer <JWT>`.
2. An explicitly enabled same-origin browser deployment stores the same identity-only
   JWT in an `HttpOnly` cookie. React never receives or stores that JWT.

When an Authorization header is present, it always takes precedence. An invalid
explicit Bearer credential returns `401`; authentication never falls back to a valid
cookie. JWTs contain only `{id, loginType: "admin"}` plus standard issue/expiry
claims. Active User, active Roles, effective active Permissions, and System Admin
status are reloaded from PostgreSQL on every protected request.

## Browser configuration

Browser authentication is disabled by default:

| Environment variable | Default | Rule |
| --- | --- | --- |
| `ADMIN_BROWSER_AUTH_ENABLED` | `false` | Must be explicitly enabled by the browser deployment. |
| `ADMIN_AUTH_COOKIE_NAME` | `yc_admin_session` | Restricted to safe cookie-name characters. |
| `ADMIN_AUTH_COOKIE_SECURE` | `true` | Must remain true outside explicit local development. |
| `ADMIN_AUTH_COOKIE_SAME_SITE` | `lax` | May be tightened to `strict`; no `none` mode. |
| `ADMIN_AUTH_COOKIE_MAX_AGE_SECONDS` | `28800` | Eight hours; validated range is 15 minutes through 12 hours. |
| `ADMIN_AUTH_ALLOWED_ORIGIN` | unset | Required when enabled; exact origin with no path/query/fragment. HTTPS is required outside local development. |

The cookie is always `HttpOnly`, uses `Path=/`, has no `Domain` attribute, and uses
the configured `Secure`, `SameSite`, and `Max-Age` values. Browser JWT expiry is
signed to the same configured maximum age and does not inherit the legacy bearer
`JWT_EXPIRES_IN=30d` default.

## Login and identity bootstrap

`POST /api/admin/v1/auth/login` keeps the existing JSON body:

```json
{"emailOrUsername":"admin","password":"..."}
```

When browser authentication is enabled and the request includes an approved Origin
or Referer, successful login sets the cookie and returns only safe metadata:

```json
{"data":{"authentication":"browser-cookie","expiresAt":"...","user":{"id":1,"name":"...","username":"..."}}}
```

The JWT is absent from that JSON. Origin-less clients retain the existing Bearer
response for compatibility. A browser must call `GET /api/admin/v1/auth/me` after
login and on application bootstrap. `/auth/me` is the authoritative identity/RBAC
response and works identically with either transport.

## CSRF and same-origin requirement

Cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests require an exact
`Origin` match. If Origin is absent, a syntactically valid Referer with the same exact
origin is accepted; if both are absent, the request is rejected. Safe GET requests
remain usable without those headers. Bearer-authenticated requests do not use this
browser CSRF check.

This release does not add a double-submit token. A state-free token would add no
meaningful protection beyond the exact Origin/Referer check, and a genuinely
session-bound token needs server-side session state. `SameSite=Lax`, exact-origin
validation, and same-origin routing are therefore all required. These controls do
not mitigate same-origin script compromise; the React deployment still needs a
restrictive CSP and normal XSS prevention.

Do not enable broad credentialed CORS. The expected production arrangement is:

```text
https://<admin-host>/
https://<admin-host>/node-api/*  -> Admin API /api/*
```

The reverse proxy must preserve the browser Origin and route `/node-api` before the
SPA fallback. Because the required cookie Path is `/`, the browser will attach this
distinct cookie to other same-origin paths too. The proxy must strip
`yc_admin_session` (or the configured Admin cookie name) before forwarding any
non-Node upstream request, especially `/odoo-api`; it must never disclose the Node
credential to Odoo. Proxy/TLS configuration is deployment-owned and is not
implemented in this repository.

## Logout and limitations

`POST /api/admin/v1/auth/logout` validates the browser Origin/Referer when browser
auth is enabled, then expires the cookie. It is idempotent and succeeds when the
cookie is already missing or expired.

There is no JWT deny-list, refresh-token family, or server-side session store in v1.
Logout removes the browser-held credential but cannot centrally revoke JWT material
that was copied before logout. The short browser lifetime bounds that exposure.
Disabling the User, removing all active Roles, or changing active Permissions still
takes effect on the next request because authorization is database-rehydrated.

The existing login limiter remains process-local at ten attempts per apparent client IP
per 15 minutes (successful attempts count). A multi-instance production deployment still
requires shared ingress/store-backed throttling. Redis is not introduced by this release.

## Trusted proxy configuration (`ADMIN_TRUST_PROXY`)

The limiter keys on Express `req.ip`. Without configuration Express uses the TCP peer, so
behind the `/node-api` reverse proxy every Admin would share the proxy's bucket.
`ADMIN_TRUST_PROXY` sets Express `trust proxy` from a validated value:

| Value | Meaning |
| --- | --- |
| empty / `false` (default) | Trust nothing. `X-Forwarded-For` is ignored; `req.ip` is the TCP peer. |
| `1`-`5` | Trust exactly that many proxy hops. The TCP peer counts as the first hop, so `req.ip` is the N-th address from the right of `X-Forwarded-For` (`1` = the right-most entry). Entries further left, which the client can forge, are ignored. |
| comma list | Trust only peers matching these IPs, CIDR subnets (IPv4 prefix ≥ /8, IPv6 ≥ /16) or presets `loopback`, `linklocal`, `uniquelocal`. |

`true`, `0`, functions, over-broad subnets and malformed entries fail startup validation.

Production setup:

1. Count every reverse proxy between the browser and this process that appends to
   `X-Forwarded-For` — for example the frontend host's `/node-api` rewrite edge, plus any
   platform load balancer or ingress in front of the container. Set `ADMIN_TRUST_PROXY` to
   that exact count. A direct `/node-api` edge → container route is `1`; edge → platform
   load balancer → container is `2`. Confirm the topology with the hosting provider before
   deploying; do not guess.
2. If the immediate proxies have stable, documented addresses (for example an internal
   load-balancer subnet), prefer an explicit address list over a hop count.
3. The service must be reachable **only** through those proxies. With a hop count, the
   nearest peer is trusted unconditionally: if the backend is also reachable directly, a
   client can send its own `X-Forwarded-For` and choose its rate-limit key. Restrict
   inbound traffic to the proxy path (firewall, private networking or platform ingress
   rules) or leave the setting at `false`.
4. Too low a count reintroduces a shared proxy bucket; too high a count lets clients
   choose their key. Verify after deployment that two Admins on different networks are
   throttled independently.

Only the login limiter reads `req.ip` today; the setting does not change the cookie,
Origin/Referer checks, JWT handling or RBAC.

## Future hardening

An opaque, revocable server-side session backed by an approved shared store remains
optional future hardening. It is not current behavior and is not required to describe
Browser Admin Authentication v1 accurately.
