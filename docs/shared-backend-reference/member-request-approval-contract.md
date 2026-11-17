# Membership Request Approval/Rejection Contract — Phase 3M

## Outcome

**No approval or rejection HTTP route is implemented or enabled.** The shared schema
can store a request decision and its Admin actor, but the verified sources do not
define the business transaction that turns an approved request into a valid active
membership. Marking a request `APPROVED` in the Admin API now would create a
potentially false entitlement state.

This is a documentation-only Phase 3M result. No application source, Prisma schema,
migration, test data, or reference-backend file was changed.

## Evidence reviewed

### Shared data model

| Concern | Confirmed evidence | Consequence |
| --- | --- | --- |
| Request identity and state | `MemberRequest` requires `memberId`, `memberTypeId`, and `memberPlanId`; state is `PENDING`, `APPROVED`, or `REJECTED` (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:208-245`). | A canonical request state can be persisted. |
| Decision audit | `approvedById`/`approvedAt` and `rejectedById`/`rejectedAt` reference `User` (`schema.prisma:235-240`). | The decision actor/time can be recorded, but there is no immutable decision-event history. |
| Payments | A request has `Payment[]`; each `Payment.memberRequestId` is optional; payment state is `DRAFT`, `ACCEPT`, or `DECLINE` (`schema.prisma:961-1005`). | There may be zero, one, or many candidate payments. The authoritative payment and prerequisite are not determined by the schema. |
| Membership lifecycle | `Member` has optional `memberTypeId`, but no active-plan, effective-from, expiry, renewal, cancellation, or entitlement relation. `MemberPlan.duration` is an integer and `expiredAt` is a nullable string (`schema.prisma:147-177`, `schema.prisma:247-335`). | The database cannot prove current membership or safely calculate/preserve expiry from a decision. |
| Request snapshots | No request price, duration, proof, confirmed-at, expiry, or request-number fields are stored. | A decision cannot preserve the commercial terms that were reviewed. |

The initial migration establishes the request/payment foreign keys but does not add a
status-transition check, payment-to-request uniqueness rule, or an index/constraint
that serializes request processing
(`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/migrations/20260307042531_init/migration.sql:176-189,649-661,948-957`).

### Mobile request/payment creation

The mobile gym-request flow verifies an active plan of hard-coded type ID `1`, rejects
members already labelled Gym or Trainer by *name*, then creates a `MemberRequest`
without a payment (`app/services/member/v1/membership/member-request.service.ts:897-956`).

The mobile plan-payment controller can instead create a pending request and a linked
`DRAFT` payment in one transaction. For a provided trainer request, it verifies the
request belongs to the Member and has hard-coded type ID `2`; otherwise it creates a
new request. It records a client-supplied amount and opaque attachment
(`app/controllers/member/v1/membership/payment.controller.ts:135-241`).

These are two distinct paths. They do not establish that every pending request requires
payment, that a payment must be `ACCEPT`, or whether a later payment may supersede an
earlier one.

### Existing Admin mutations are not reusable

The reference Admin route exposes a generic `POST /:id` behind
`member-request:update` (`routes/admin/v1/member-request.route.ts:22-38`). Its update
service must **not** be copied:

1. It marks the request `APPROVED` and then, in a separate write, sets the Member to
   hard-coded `memberTypeId: 2` (`app/services/admin/v1/member-request.service.ts:82-127`).
   This is incorrect for gym requests and has no plan/expiry effect.
2. The two writes are not in one transaction and do not lock or conditionally update
   the request. A failure can leave an approved request with no member-side effect.
3. It checks only two approval cases. It permits `APPROVED → REJECTED`, permits
   re-rejection, and does not make a decision idempotent
   (`app/services/admin/v1/member-request.service.ts:72-145`).
4. It never reads or changes payment state, does not verify the Member/plan is still
   eligible, and returns a Member rather than the resulting request
   (`app/services/admin/v1/member-request.service.ts:148`).

Payment acceptance/decline is also a separate generic Admin operation. It updates
payment audit fields only and has no request or member lifecycle effect
(`app/services/admin/v1/paymet.service.ts:163-204`). Therefore a payment can be
`ACCEPT` while its request remains pending, and the reverse is also possible.

### Existing Admin and Odoo/frontend compatibility

The standalone Admin project currently implements only protected read endpoints:

- `GET /api/admin/v1/member-requests` — `member-request:list`
- `GET /api/admin/v1/member-requests/:id` — `member-request:read`

The existing React/Odoo page uses legacy `draft`, `paid`, and `rejected` vocabulary,
shows payment photo/confirmation/expiry fields, and offers decisions only for `draft`.
Those do not map safely to the canonical enum or schema:

- `draft` could map to `PENDING` only by an explicit compatibility decision.
- `paid` is neither `MemberRequestStatus` nor a proof that a payment is `ACCEPT` and
  must not be treated as `APPROVED`.
- proof/expiry/confirmation date have no verified request-level source.

See `/Users/arkar/Desktop/yc-fitness-admin-api/docs/shared-backend-reference/membership-request-compatibility.md`
and `/Users/arkar/Desktop/admin-site/docs/admin-nodejs-v1/02-rest-api-specification.md:43-52`.

## Confirmed permission and audit capability

`member-request:update` exists in the shared seed catalog
(`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts:83-96`).
It is the only verified existing decision permission. Granting it must remain explicit
per Admin role; its existence does not resolve lifecycle semantics.

The request schema can capture the decision actor through the existing `User` relation.
It cannot distinguish a retried decision from a new one, record a before/after event,
or correlate an action with a payment review without an agreed audit approach.

## Required owner-approved state machine

The following is a required decision matrix, not an implemented contract:

| Event | Questions requiring owner approval before code | Minimum persisted result once approved |
| --- | --- | --- |
| Approve pending request | Does it require a payment? If yes, which linked payment qualifies, must it be `ACCEPT`, and how are multiple/declined/draft payments resolved? Is a currently inactive plan rejectable? | Request status/audit plus every approved entitlement/payment/member effect in one transaction. |
| Activate membership | Is a membership represented by `Member.memberTypeId`, a new entitlement record, or an existing service outside this schema? What is start time, duration unit, expiry calculation/timezone, renewal/upgrade rule, and historical snapshot? | A durable historical entitlement with plan/type/price/duration/effective period, or an owner-approved equivalent. |
| Reject pending request | Is a reason mandatory? Must linked `DRAFT` payment(s) be declined, left pending for retry, or refunded externally? Are attachments retained? | Request rejection audit and explicitly approved payment/retry effects. |
| Retry/cancel | Can a rejected request be re-opened, or must the Member create a new request? Can a second request coexist? Who can cancel it? | Enforced transitions and documented client behaviour. |
| Terminal retry | Should a repeated identical request return the prior decision (idempotent) or `409`? | Stable `409 REQUEST_STATE_CONFLICT` or an explicit idempotent response. |

Until these are answered, permitted transitions must not be inferred from enum order or
the old generic update implementation. In particular, **do not** approve merely by
setting `Member.memberTypeId`; doing so loses plan/expiry/history and can overwrite an
unrelated current type.

## Required transactional/concurrency design after approval

The future shared backend owner should implement one canonical decision service, used by
both Admin and any other writer. It should:

1. Authenticate/authorize the Admin and resolve the assigned permission before entering
   the transaction.
2. Start an interactive transaction at an owner-approved isolation level, lock the
   request row (`SELECT ... FOR UPDATE`) or use a conditional update whose predicate is
   `status = PENDING`. Lock/read all linked candidate payments deterministically by ID.
3. Re-read Member, plan/type, required payment(s), and existing entitlement inside that
   transaction. Apply the approved decision matrix, never arbitrary numeric type IDs.
4. For approval, atomically write the request audit, accepted payment audit if that is
   part of the approved workflow, and the durable membership entitlement/effective
   period. For rejection, atomically write the request audit and only the explicitly
   approved payment/retry effects.
5. Treat a failed conditional write / terminal state as `409 REQUEST_STATE_CONFLICT`;
   do not silently overwrite a decision. Map deadlock/serialization retries internally
   and expose a deterministic conflict after a bounded retry policy.
6. Return a newly selected safe request DTO, excluding payment attachments, bank details,
   password hashes, and raw storage values.

This design is a recommendation only. It cannot be implemented safely until the
membership representation and payment policy are approved. A schema migration may be
necessary for a membership-entitlement/history table and a decision/audit event; none
is proposed or created in this phase.

## Endpoint status

| Endpoint | Status | Reason |
| --- | --- | --- |
| `POST /api/admin/v1/member-requests/:id/approve` | **Deferred / not registered** | Required entitlement, payment, expiry, and retry rules are unverified. |
| `POST /api/admin/v1/member-requests/:id/reject` | **Deferred / not registered** | Linked payment/retry/reason policy and terminal transition rules are unverified. |

The existing read endpoints remain unchanged.

## Test plan for the approved implementation

Use a separately named disposable isolated PostgreSQL database or scoped unique
fixtures. Do not truncate the retained Stage 3I database.

1. Pending → approved according to the exact approved payment prerequisite.
2. Pending → rejected with the approved reason/retry/payment effects.
3. Missing request, inactive/missing Member, inactive/replaced plan, and invalid linked
   payment state.
4. Every defined terminal/retry transition, including duplicate approval/rejection.
5. Two simultaneous Admin decisions for one request: exactly one durable decision and
   one deterministic conflict/idempotent outcome.
6. Transaction rollback when any entitlement/payment/member write fails: no partial
   approval or audit mutation.
7. Correct `approvedById`/`approvedAt` or `rejectedById`/`rejectedAt`, permission
   denial, inactive Admin, wrong JWT identity type, and no secret/proof exposure.
8. Flutter/mobile history compatibility: old installed clients can still read their
   expected request/payment history, and no mobile request flow is unintentionally
   changed.

No new automated tests were added or run because no implementation was authorized by
the verified contract; existing member-request integration tests use destructive
database cleanup and are intentionally out of scope for this retained-fixture phase.

## Exact blockers and next step

1. Product and shared-backend owner must approve the request/payment state diagram,
   including `PENDING` payment prerequisites and rejection/retry/cancellation behaviour.
2. Owner must identify the authoritative membership entitlement model and approve its
   schema/service design, including plan price/duration snapshots and effective/expiry
   calculation. No current model proves active membership.
3. Owner must decide whether `Member.memberTypeId` is a derived current classification
   and, if so, when it is updated without overwriting another entitlement.
4. Owner must approve a payment-proof authorization/retention policy; opaque
   `Payment.attachment` must not become a public URL.
5. Owner must approve idempotency and concurrency responses, plus the role assignments
   for `member-request:update`.

**Recommended next implementation step:** have the shared mobile/backend owner publish
and test a single canonical membership-decision service (and any required entitlement
migration) against an isolated database. Once its side effects and migration are
approved, the Admin API can call or reproduce that service transactionally and expose
the two narrowly scoped protected endpoints.
