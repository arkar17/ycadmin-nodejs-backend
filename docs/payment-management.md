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
does not reverse the committed database result.

## Payment push (FCM)

Payment push is **disabled by default**. With `PAYMENT_PUSH_ENABLED=false` (or unset)
the router uses `DisabledPaymentPushNotificationService`, the Firebase Admin SDK is
never loaded, startup succeeds, and one `payment_push`/`disabled` info event is logged.

### Environment variables

| Variable | Default | Required |
|---|---|---|
| `PAYMENT_PUSH_ENABLED` | `false` | `true` enables FCM delivery |
| `FIREBASE_CREDENTIAL_SOURCE` | `service_account` | `service_account` or `application_default` |
| `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` | — | when enabled in `service_account` mode; must be unset in `application_default` mode |
| `FIREBASE_PROJECT_ID` | — | required in `application_default` mode; optional in `service_account` mode, where it must match the credential's project |
| `PAYMENT_PUSH_TIMEOUT_MS` | `5000` | integer 500–15000 |

When push is enabled, invalid configuration (missing credential, invalid base64,
invalid JSON, missing `project_id`/`client_email`/`private_key`, project mismatch,
SDK load or initialization failure) **fails startup** with a fixed message that never
contains environment values, decoded credential content, or `JSON.parse` text.

### Credential modes

- **Service account (`service_account`).** Supply the service-account JSON as a single
  base64 value injected by the deployment secret manager (line-wrapped base64 is
  accepted). Use a **dedicated Admin service account** with only the
  `roles/firebasecloudmessaging.admin` role so it can be rotated independently.
- **Application Default Credentials (`application_default`).** For runtimes with
  workload identity (for example Cloud Run/GKE) or a developer's
  `gcloud auth application-default login`. Set `FIREBASE_PROJECT_ID`.

**Never commit credential JSON** to this repository, `.env.example`, Docker build
contexts, or images. The Mobile API's `yc-fitness-firebase.json` must **not** be
copied, referenced, or reused here; that key is treated as exposed and must be rotated
by the Mobile API owners.

### Initialization

`src/config/push.ts` validates configuration; `src/integrations/firebase/firebase-messaging.ts`
lazily imports `firebase-admin/app` and `firebase-admin/messaging` and initializes a
named app, `yc-admin-push`, exactly once (the global default app is never used);
`src/modules/payments/payment-push.factory.ts` composes the adapter that
`src/routes/admin-v1.ts` injects into the Payment router.

### Mobile-compatible payload

`FcmPaymentPushNotificationService` sends exactly what the Mobile API sends for
Payment decisions:

```json
{ "token": "<MemberFcmToken.token>", "notification": { "title": "<message>", "body": "<message>" } }
```

with `Your payment has been accepted.` or `Your payment has been declined.` as both
title and body. No `data`, `android`, `apns`, Payment/Member IDs, `model`, `res_id`, or
`type` are added; navigation metadata lives in the Notification row. The single
`MemberFcmToken` row selected by the repository is used (never `Member.voipToken`),
and tokens are never deleted or modified by the Admin service.

### Post-commit, best-effort delivery

One send attempt per changed decision, bounded by `PAYMENT_PUSH_TIMEOUT_MS`, with no
retries (the Payment and Notification are already committed, so a retry could
duplicate the push) and no outbox. Provider failures are mapped to sanitized errors —
`FcmTokenInvalidError`, `FcmCredentialError`, `FcmProviderRejectedError`,
`FcmTransientError`, `FcmTimeoutError`, `FcmUnknownError` — which carry a fixed message
and at most a safe Firebase code, never the token, provider message, response, or
original error. `PaymentService` logs them as a warning (`failureType`, `requestId`,
`paymentId`, `memberId`) and still returns the successful committed decision. Success
logs an info event `payment_push`/`sent` with `paymentId`, `memberId`, and `durationMs`.
FCM tokens and credentials are never logged, and the logger additionally redacts
`token`, `*.token`, `pushTarget.token`, `private_key`, `privateKey`, `credential`, and
`serviceAccount` fields.

## Data exposure and deferred policy

Repository records replace the raw attachment with `hasPaymentProof`; attachment
storage values never leave the repository. Payment detail exposes only the bank ID,
display name, and payment type, not account holder, account number, phone, or cover
photo.

No price check is performed. The authoritative workflow stores a client-provided
amount and has no reliable immutable catalogue-price snapshot. Price comparison,
refunds, proof viewing/signed URLs, guaranteed push delivery, and membership/shop
decision coupling remain separate product decisions.
