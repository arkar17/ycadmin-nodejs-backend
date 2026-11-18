# Membership Request Decision Contract

## Implemented endpoints

- `POST /api/admin/v1/membership-requests/:id/approve` with `{ "paymentId": positiveInteger }`
- `POST /api/admin/v1/membership-requests/:id/reject` with `{ "paymentId": positiveInteger, "reason": nonEmptyString }`

Both endpoints require the existing `member-request:update` permission. Bodies are
strict: missing, non-integer, non-positive, and unknown fields are rejected. The
System Admin RBAC bypass remains unchanged.

## Atomic decision rules

The selected Payment must belong to the request and Member, have request type
`MEMBER_PLAN_UPGRADE`, match the request's MemberPlan and MemberType, and have no shop
upgrade linkage. Approval permits `DRAFT` (changed to `ACCEPT`) or historical `ACCEPT`
and rejects `DECLINE`. Rejection permits `DRAFT` (changed to `DECLINE`) or historical
`DECLINE` and rejects `ACCEPT` because reversal/refund is outside this workflow.

One retryable `SERIALIZABLE` transaction applies the Payment audit fields, terminal
MemberRequest audit fields, requested `Member.memberTypeId`, applicable MemberProfile
data, and one SYSTEM Notification. Conditional `PENDING` updates plus serializable
retries protect approve/approve, approve/reject, different-payment, and standalone
Payment-decision races. Opposite terminal decisions return
`MEMBERSHIP_REQUEST_STATE_CONFLICT`; a replay is idempotent only when the same selected
Payment is already in the compatible terminal state.

Approval never hard-codes a MemberType ID. The schema has no immutable semantic key
for Gym/Trainer. The Mobile trainer request contract requires age, gender, experience,
and reason while the Gym contract accepts only a plan, so the Admin flow uses that
complete persisted trainer-request shape as its non-corrupting discriminator. It
updates only trainer fields that exist and preserves unrelated profile fields.
Rejection never changes Member or MemberProfile.

## Proof review contract

`Payment.attachment` remains an opaque Mobile-origin value, but the exact current UAT
DigitalOcean Spaces format is recognized by a strict classifier. Detail summaries
expose `paymentProofStatus` and an Admin API proof path only when the stored value
exactly matches that format. They never expose the attachment, origin, bucket, or
storage key.

The authenticated proof endpoint is disabled by default. When enabled, it validates
the selected Payment's exact request/member/plan/type relationship before any network
access. It derives a fixed HTTPS target from the validated filename rather than
fetching `Payment.attachment`, rejects redirects and compressed responses, applies
timeout/byte/pixel limits, validates the encoded image, strips metadata, and returns a
normalized WebP with private no-store headers. Mobile-local URLs, historical values,
and all other formats are `UNSUPPORTED_FORMAT` and are never fetched. A future broader
storage contract still requires canonical key/metadata ownership rather than relaxing
this classifier.

## Schema limitation

The database has no per-Member plan entitlement/history, membership effective/start
date, expiry, renewal history, or immutable commercial snapshot. Approval retains the
request's `memberPlanId` but does not manufacture entitlement data in unrelated
fields. Product and schema owners must decide whether and how to add that model in a
separate change.

## Verification

The isolated PostgreSQL suite covers safe proof summaries, authenticated proof access,
relationship validation before fetch, normalized output, unsupported legacy values,
upstream failure behavior, approval/rejection coupling,
audit clearing, Gym and trainer-shaped behavior, accepted/declined payments,
relationship mismatches, terminal idempotency/conflicts, permission revocation,
concurrent opposite/different-payment decisions, standalone Payment races, exactly one
notification, and rollback failures at Payment, MemberRequest, Member, and
Notification stages.
