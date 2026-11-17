# Shop Plan Levels Compatibility — Phase 3N

## Outcome

The Admin API now exposes the verified shared **ShopLevel catalogue** as a distinct,
read-only resource:

- `GET /api/admin/v1/shop-plan-levels` — requires `shop-level:list`
- `GET /api/admin/v1/shop-plan-levels/:id` — requires `shop-level:read`

`POST`, `PATCH`, and `DELETE` are deliberately not registered. The Odoo
`plan_level_type` editor is not equivalent to `ShopLevel`, and the existing mobile
sources do not define safe catalogue-mutation semantics for live shops, upgrade
requests, payments, price/duration history, or media.

## Verified model and relationship mapping

`ShopLevel` is a shared mobile shop-tier catalogue, not `MemberType` or
`MemberPlan` (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma:482-504`).

| Odoo/frontend field | Verified Prisma field | Compatibility decision |
| --- | --- | --- |
| `name` | `ShopLevel.name` (unique) | Supported as the ShopLevel display name. |
| `post_limit_count` | `ShopLevel.postLimit` | Supported only as the real mobile shop post quota. |
| `level_count` | None | **Unsupported.** It must not be inferred from `id`, `price`, `duration`, or `durationId`. |
| not exposed by Odoo level page: price | `ShopLevel.price` integer | Returned by the new ShopLevel API as verified catalogue data; mutation deferred. |
| not exposed by Odoo level page: duration | `ShopLevel.duration` integer plus optional `durationId → PlanDuration` | Returned with the linked duration when present. Existing migration backfilled legacy values that may be months or day multiples; no new interpretation is created here. |
| not exposed by Odoo level page: enabled state | `ShopLevel.status` | Returned. The mobile discovery services use `ACTIVE`; changing it has mobile behaviour and is deferred. |
| description/image | nullable `description` / opaque string `image` | Omitted from the DTO. There is no approved media URL/access/upload contract. |

The current React page calls Odoo JSON-RPC `/plan_level_type/*` and requires all three
of `name`, `level_count`, and `post_limit_count`
(`/Users/arkar/Desktop/admin-site/src/api/planLevelTypesApi.ts:5-63`; `/Users/arkar/Desktop/admin-site/src/pages/MemberTypeLevelsPage.tsx:95-180`).
It cannot be switched to this endpoint unchanged, because `level_count` has no
verified shared-database representation.

## Confirmed mobile dependencies

`ShopLevel` is referenced by:

- `Shop.shopLevelId` — nullable and database `ON DELETE SET NULL`
  (`schema.prisma:506-527`; initial migration lines 986-990).
- `ShopUpgradeRequest.shopLevelId` — required and database `ON DELETE RESTRICT`
  (`schema.prisma:529-552`; initial migration lines 998-1002).
- `Payment.shopLevelId` — nullable and database `ON DELETE SET NULL`
  (initial migration lines 1163-1167).
- optional `PlanDuration` via `durationId`; the later shared migration backfills this
  relation without removing the legacy scalar `duration`
  (`prisma/migrations/20260805143000_add_duration_id_to_member_plan_and_shop_level/migration.sql:17-71`).

Mobile services list only active levels and expose `postLimit` as the shop-post count
(`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/services/member/v1/shops/shop-level.service.ts:1-51`; `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/controllers/member/v1/shops/shop-level.controller.ts:80-128`).
The mobile shop creation path also selects a `Free` active ShopLevel and assigns its
post quota. A mutation to that record could alter shop onboarding and existing shop
capacity (`app/controllers/member/v1/shops/member-shop.controller.ts:300-342`).

## Read API contract

### List

`GET /api/admin/v1/shop-plan-levels?name&status&durationId&postLimit&limit&offset`

- `name`: case-insensitive substring.
- `status`: canonical shared `Status` enum only.
- `durationId`: positive canonical `PlanDuration` ID.
- `postLimit`: integer quota, zero or greater.
- `limit`: 1–100, default 20; `offset`: zero or greater.
- ordering: `createdAt DESC, id DESC`.
- unknown, malformed, or unsupported filters, including `levelCount`, return `422`.

Response fields are deliberately restricted to verified catalogue data:

```json
{
  "data": [{
    "id": 7,
    "name": "Level 3",
    "price": 25000,
    "duration": 3,
    "postLimit": 20,
    "status": "ACTIVE",
    "planDuration": { "id": 3, "name": "3 Months", "value": 3 },
    "createdAt": "2026-10-01T00:00:00.000Z"
  }],
  "pagination": { "total": 1, "limit": 20, "offset": 0, "currentPage": 1, "totalPages": 1 }
}
```

`planDuration` is `null` when the pre-existing level has no linked duration. The API
does not fabricate a duration relation from the legacy scalar.

### Detail

`GET /api/admin/v1/shop-plan-levels/:id` returns the same DTO or `404 NOT_FOUND`.

Both endpoints require an authenticated active Admin according to the existing
database-backed JWT/RBAC middleware. A verified JWT alone is insufficient; inactive
Admins receive `401`, and a missing/revoked required permission receives `403`.

## Permission audit

The shared permission catalog confirms all five shop-level permission names:
`shop-level:list`, `shop-level:read`, `shop-level:create`, `shop-level:update`, and
`shop-level:delete`
(`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts:449-469`).

Only `list` and `read` are used. No new permission is proposed and no role assignment
was changed. The reference Admin route supports mutations, but its service uploads an
image, accepts mutable price/duration/quota/status, and physically deletes the row
without a reference check (`app/services/admin/v1/shop-level.service.ts:216-383`). It
is not safe to reuse for this Admin API.

## Deferred endpoint and deletion policy

| Proposed endpoint | Status | Reason |
| --- | --- | --- |
| `POST /shop-plan-levels` | Deferred | The frontend’s `level_count` cannot be stored; required commercial fields and duration semantics are not an approved Admin workflow; image upload has no approved storage policy. |
| `PATCH /shop-plan-levels/:id` | Deferred | Changes to price, duration, quota, status, or description can change mobile catalogue/discovery and active shop behaviour. No historical/versioning rule is confirmed. |
| `DELETE /shop-plan-levels/:id` | Deferred | Database would null some references and reject others. The Admin policy must instead block deletion whenever **any** `Shop`, `ShopUpgradeRequest`, or `Payment` references the level, preserving history. |

The database unique constraint on `ShopLevel.name` is confirmed
(`prisma/migrations/20260307042531_init/migration.sql:830-837`). A future mutation API
must convert violations to a deterministic conflict and use an explicit safe
inactivation/version policy before modifying a referenced level. It must not rely on
the database `SET NULL` behaviour for historical shop/payment records.

## Tests and verification

- TypeScript typecheck: passed.
- Production build: passed.
- Complete mocked suite: **16 files / 59 tests passed**.
- New ShopLevel mocked router tests: **3 passed** (authentication, individual
  permissions, filters/pagination, DTO safety, malformed input, missing detail).
- New scoped PostgreSQL integration test: **2 passed** against the protected
  `127.0.0.1:55432/yc_fitness_admin_integration` database.

The integration test creates unique synthetic Admin/role/permission/duration/level
fixtures and removes only those IDs. It does not truncate, reset, seed globally, or
alter retained Stage 3I fixtures.

## Remaining decisions and Dashboard readiness

1. Product owner must decide whether Odoo `level_count` needs a new canonical model,
   a different mapping, or retirement from the redesigned UI. It is not a ShopLevel
   field.
2. Shared-backend owner must define catalogue versioning/inactivation and how price,
   duration, post quota, and status changes affect existing shops, pending/approved
   upgrades, and payment history.
3. A secure storage/upload/access policy is required before ShopLevel image reads or
   writes can be exposed.
4. A future delete endpoint must use reference counts for `Shop`, `ShopUpgradeRequest`,
   and `Payment` and return `409 SHOP_LEVEL_IN_USE` rather than cascading or nulling
   historical relationships.

This read-only catalogue is safe as a narrow Dashboard/reference-data input, but it
does **not** make Dashboard shop-plan revenue, active-tier distribution, or historical
upgrade metrics safe: those require approved payment, entitlement, and point-in-time
status semantics.
