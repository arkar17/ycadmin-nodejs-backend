# Bank Information compatibility — Phase 3E

This document records the verified shared-schema contract used by the Admin REST API. It was reviewed without contacting a non-local database.

## Verified model and mobile dependencies

`BankInformation` is defined at `prisma/schema.prisma:941-957` (identical to the copied mobile reference schema). It has required `name`, `bankAccountHolder`, `bankAccountNumber`, and `phone`; optional `coverPhoto`; `paymentTypes PaymentTypes` defaulting to `BANK_ACCOUNT`; and `status Status` defaulting to `ACTIVE`.

`Payment.bankInformationId` is required (`prisma/schema.prisma:987-988`). The verified initial migration gives this relation `ON DELETE RESTRICT` (`prisma/migrations/20260307042531_init/migration.sql:1167`). The member payment controller also accepts only an active destination by ID and checks a supplied bank name against it (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/controllers/member/v1/membership/payment.controller.ts:102-129`). Consequently, changing or deleting a destination with payments could alter the meaning of historical payment records or break the foreign key. The Admin API rejects every update and delete when one or more `Payment` records reference the destination.

Mobile member list formatting currently returns full account numbers and stored `coverPhoto` URLs (`/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/app/controllers/member/v1/membership/bank-information.controller.ts:25-37`). That is mobile behavior, not an authorization-safe Admin list contract.

## Odoo/frontend-to-Prisma map

| Frontend/Odoo field | Verified Prisma field | Admin API support | Notes |
| --- | --- | --- | --- |
| `name` | `BankInformation.name` | Supported | Required text. |
| `payment_type` (`bank`, `ewallet`) | `paymentTypes` | Supported with REST names `BANK_ACCOUNT`, `E_WALLET` | These are the only verified enum values (`schema.prisma:1518-1521`). The legacy frontend spelling is not silently remapped in mutation bodies. |
| `account_number` | `bankAccountNumber` | Supported as `accountNumber` | Required by the model for both enum variants. Lists return only `accountNumberMasked`; `GET /:id` requires the separate read permission and returns it. |
| `account_holder` | `bankAccountHolder` | Supported as `accountHolder` | Required by the model for both enum variants. |
| `phone` | `phone` | Supported | Required by the model for both enum variants. |
| `image` | `coverPhoto` | Unsupported | It exists but has no verified secure upload, access-control, lifecycle, or deletion policy for this standalone Admin API. The Admin routes neither accept nor expose it. |

The schema does not make account number or phone unique. The reference service checks active records before writes (`app/services/admin/v1/bank-information.service.ts:157-186`), but that cannot provide a database-level concurrency guarantee. The Admin API preserves the active-record conflict rule and returns `409 BANK_INFORMATION_CONFLICT`; adding a durable unique constraint requires shared-schema ownership and is out of scope.

## Permissions

The copied shared permission catalog already defines `bank-information:list`, `bank-information:read`, `bank-information:create`, `bank-information:update`, and `bank-information:delete` (`prisma/seeds/permission.seeder.ts:207-228`). The Admin API uses exactly these names. Roles must receive them explicitly in the shared RBAC data; isolated-test grants are synthetic and do not provision any real role.

## Approved future media approach

Bank-information images remain out of scope for this phase. When implemented, restricted images must be stored as private DigitalOcean Spaces objects and delivered only through short-lived signed URLs after an authorized request. The object key must remain private; clients must not receive a permanent public object URL or storage credentials.

Payment QR images may have a different audience and potentially need public delivery. They require a separate product and security access-policy decision before any public object ACL, CDN route, or unauthenticated URL is introduced. This decision does not authorize upload or serving behavior in the current API.

## Admin REST contract differences and remaining decisions

The enabled API is `/api/admin/v1/bank-information`, rather than the Odoo JSON-RPC paths. It uses camelCase JSON and JSON request bodies, not multipart requests. The list accepts canonical `bankOrPhone` plus read-only compatibility alias `bank_or_phone`; mutation aliases such as `payment_type` are intentionally rejected to keep a deterministic REST contract.

The existing React page expects a full account number and image in its list item. It must be adapted to fetch `GET /:id` before editing and to handle no image until a secure storage policy is approved. It also uses `bank`/`ewallet`, which needs a deliberate frontend-to-REST enum mapping. No React file was changed in Phase 3E.

The schema requires all three account/contact fields for both payment types, so no different bank-versus-wallet field rules were inferred. A product owner must approve any type-specific relaxation before it can be implemented with a schema change.
