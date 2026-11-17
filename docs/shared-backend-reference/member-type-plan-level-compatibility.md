# Member Type and Odoo Plan Level compatibility

## Conclusion

The Odoo `plan_level_type` resource cannot be mapped safely to any verified Prisma model. No `/api/admin/v1/plan-level-types` route is implemented.

The Admin API does provide a separate, read-only `GET /api/admin/v1/member-types` endpoint because `MemberType` is a verified shared reference model with a confirmed `member-type:list` permission. It is not a replacement for the existing Odoo Plan Levels page.

## Odoo Plan Level contract

The active frontend calls `/plan_level_type/*` and treats each row as:

| Odoo/frontend field | UI meaning | Verified Prisma mapping |
|---|---|---|
| `name` | Shop Plan Level label | `ShopLevel.name` is a partial semantic match only |
| `level_count` | Rent Level | **No verified field** |
| `post_limit_count` | Shop Post Count | `ShopLevel.postLimit` is a partial name/value match only |

Sources: `/Users/arkar/Desktop/admin-site/src/api/planLevelTypesApi.ts:5-35` and `/Users/arkar/Desktop/admin-site/src/pages/MemberTypeLevelsPage.tsx:253-257`.

`ShopLevel` is not an Odoo Plan Level substitute: it also has price, duration/durationId, description, image, status, audit columns, and relations to `Shop`, `ShopUpgradeRequest`, and `Payment`. The reference backend manages it under distinct `shop-level:*` permissions. It has no `levelCount` field. Sources: shared schema `prisma/schema.prisma:482-504` and reference route `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/admin/v1/shop-level.route.ts:9-60`.

`MemberType` is also not an Odoo Plan Level substitute. It has only `id`, `name`, `status`, timestamps, and relations; it has neither `levelCount` nor `postLimit`. Sources: shared schema `prisma/schema.prisma:134-145` and reference list/read route `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/routes/admin/v1/member-type.route.ts:9-37`.

`ProficientLevel` likewise has only name/status and is used for workout/member proficiency, not shop levels. Source: shared schema `prisma/schema.prisma:734-749`.

## Supported MemberType functionality

`GET /api/admin/v1/member-types?name&status&limit&offset` returns `{id,name,status}` with deterministic offset pagination and requires the confirmed `member-type:list` permission.

No MemberType mutation is enabled. The reference Admin routes expose list/read only despite catalog entries for additional actions. More importantly, deleting a MemberType would cascade to `MemberPlan` and `Member`, while `MemberRequest` restricts deletion; no approved MemberType lifecycle/deactivation rule exists for this Admin API. Sources: reference migration `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/migrations/20260307042531_init/migration.sql:924-960`.

## Required product/schema decision

To replace the Odoo Plan Levels page, the product owner must decide whether the canonical resource is a separately modeled plan-level entity or a redesigned ShopLevel API. A correct model/contract must include a defined equivalent for `level_count`, its relationship to plans/shops, and lifecycle/delete behavior. Do not infer `level_count` from `ShopLevel.duration`, price, or ID.
