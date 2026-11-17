# Payment management

The Admin Payment module uses the authoritative `Payment`, `Notification`, and
`MemberFcmToken` structures without schema, migration, seed, or permission changes.
It deliberately treats `ACCEPT` and `DECLINE` as payment-review decisions only.

## API and authorization

- `GET /api/admin/v1/payments` — `payment:list`
- `GET /api/admin/v1/payments/:id` — `payment:read`
- `POST /api/admin/v1/payments/:id/accept` — `payment:update`
- `POST /api/admin/v1/payments/:id/decline` — `payment:update`

All query, path, and body inputs are strictly validated. The decline body is exactly
`{ "reason": "..." }`; its trimmed reason must contain 1–2,000 characters.

## State and concurrency policy

`DRAFT → ACCEPT` and `DRAFT → DECLINE` are the only state-changing transitions.
Repeating the same terminal decision returns `changed: false` and does not create a
second Notification. Reversing a terminal decision returns
`PAYMENT_STATE_CONFLICT`.

The repository uses a PostgreSQL `SERIALIZABLE` transaction, the shared bounded
serialization retry helper, and a conditional `status = DRAFT` update. The Payment
audit fields and Notification row commit atomically. Acceptance explicitly clears all
decline audit fields; decline explicitly clears both approval fields.

## Relationship validation

Historical records remain readable even if their relationships are inconsistent. A
new decision is rejected with `PAYMENT_RELATIONSHIP_INVALID` when:

- `MEMBER_PLAN_UPGRADE` lacks `memberPlanId`, `memberTypeId`, or `memberRequestId`;
- it contains shop target/request IDs;
- its linked request belongs to another Member or has a different plan/type;
- `SHOP_LEVEL_UPGRADE` lacks `shopLevelId` or `shopUpgradeRequestId`;
- it contains membership target/request IDs; or
- its linked shop request belongs to another Member or targets a different level.

The service does not repair these records and never changes a MemberRequest, Member,
MemberType, MemberPlan, ShopUpgradeRequest, or Shop.

## Notification and push boundary

The transaction creates a `SYSTEM` Notification addressed to the paying Member, with
`model = "system"`, `resId = Payment.id`, and unseen/unread initial state. A failed
Notification insert rolls back the Payment decision.

Push delivery is attempted only after commit and only when the Member has an FCM
token. Delivery failure is logged with request, Payment, and Member identifiers and
does not reverse the committed database result. The Admin application currently has
no approved Firebase SDK/credential adapter, so production routing uses a disabled
adapter until that integration is supplied explicitly.

## Data exposure and deferred policy

Repository records replace the raw attachment with `hasPaymentProof`; attachment
storage values never leave the repository. Payment detail exposes only the bank ID,
display name, and payment type, not account holder, account number, phone, or cover
photo.

No price check is performed. The authoritative workflow stores a client-provided
amount and has no reliable immutable catalogue-price snapshot. Price comparison,
refunds, proof viewing/signed URLs, guaranteed push delivery, and membership/shop
decision coupling remain separate product decisions.
