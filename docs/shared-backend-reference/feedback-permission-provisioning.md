# Feedback permission provisioning

The Admin Feedback API checks two product-approved permissions:

- `feedback:list` for `GET /api/admin/v1/feedback`.
- `feedback:read` for `GET /api/admin/v1/feedback/:id`.

They are new Admin authorization decisions, not permissions found in the downloaded mobile-backend reference. This Admin repository does not modify the shared backend's permission catalog, migrations, or production role assignments.

## Required shared-backend follow-up

1. The shared-backend owner adds both names to its canonical permission catalog (currently `prisma/seeds/permission.seeder.ts`) through that repository's reviewed release process.
2. The owner explicitly associates each permission only with approved Admin roles. Neither permission should be automatically attached to every existing role.
3. Existing shared environments must be provisioned through the owner's reviewed operational process; do not create a Prisma migration solely for permission records and do not run this Admin project's integration fixtures outside the dedicated local database.
4. Before deploying this API against a shared database, verify that an intended Admin role has both permissions and that a role without either receives `403`.

The isolated integration suite creates these permissions and grants them only to synthetic roles inside `yc_fitness_admin_integration`. That fixture setup is not a production provisioning mechanism.
