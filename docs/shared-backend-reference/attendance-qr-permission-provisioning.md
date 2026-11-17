# Attendance QR permission provisioning

## Status

Phase 3G Stage 3C implements protected Admin credential-management endpoints in the Admin workspace. The copied mobile reference permission catalog does **not** define their permissions; only `attendance:list`, `attendance:read`, `attendance:create`, `attendance:update`, and `attendance:delete` are present in `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/seeds/permission.seeder.ts:585-604`.

The following names are therefore approved product additions, but are provisioned only in synthetic roles in the protected isolated integration database:

| Permission | Endpoint | Purpose |
| --- | --- | --- |
| `attendance-qr:create` | `POST /api/admin/v1/attendance/qr` | Generate the first permanent printable QR credential when none is active. |
| `attendance-qr:read` | `GET /api/admin/v1/attendance/qr` | Reprint the existing payload by decrypting the active credential. |

They are deliberately separate from `attendance:create`. Recording a check-in does not authorize disclosure of the permanent QR payload.

## Shared-backend provisioning steps

The shared mobile-backend owner must, in one approved release:

1. Add the two permission records to the authoritative permission catalog and deploy them through the shared backend’s normal provisioning process.
2. Grant each permission explicitly to approved active Admin roles. Do not grant either permission to every existing attendance administrator by default.
3. Review whether creation and reprint should require separate operators or audit approval.
4. Ensure QR-management API audit logs contain actor ID, action, credential ID, and request ID only—never the payload, fingerprint, ciphertext, IV, authentication tag, JWT, or encryption/HMAC key bytes.
5. Supply `ATTENDANCE_QR_ENCRYPTION_KEY` (exactly 32 decoded bytes) and `ATTENDANCE_QR_HMAC_KEY` (at least 32 decoded bytes) through the approved secret manager. Both values must be canonical base64 and must not be stored in PostgreSQL or committed to an `.env` file.

Until these steps are complete, normal roles receive `403 FORBIDDEN`. If the keys are absent, the Admin endpoints fail closed with `503 QR_CREDENTIAL_UNAVAILABLE`; no fallback or replacement credential is generated.

## Stage 3C contract

`POST /api/admin/v1/attendance/qr` accepts only an empty JSON object, requires an active User-side Admin JWT (`{ id, loginType: "admin" }`) plus `attendance-qr:create`, and returns `201` only when no active credential exists. A concurrent or repeated request returns `409 QR_ALREADY_EXISTS`.

`GET /api/admin/v1/attendance/qr` requires the same active Admin checks plus `attendance-qr:read`, and returns the exact existing payload. It never generates a new QR. A missing active row returns `404 QR_NOT_CONFIGURED`.

Both success responses are `{ data: { credentialId, qrPayload, createdAt } }` and set `Cache-Control: no-store, private, max-age=0`, `Pragma: no-cache`, and `Expires: 0`. There is no list/history, replacement, revocation, public lookup, image upload, or signed-URL endpoint in this stage.
