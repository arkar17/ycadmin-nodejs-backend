# Prisma integration boundary

`schema.prisma` is a byte-for-byte synchronization of the verified mobile-backend schema at `/Users/arkar/Desktop/yc-fitness-mobile-backend-reference/prisma/schema.prisma`. Do not edit models, relations, enums, or generator settings in this workspace. Synchronize only from an owner-approved upstream revision and record that revision in the corresponding change.

The Admin project uses the compatible reference dependency set: Prisma CLI `7.5.0`, `@prisma/client` and `@prisma/adapter-pg` `7.3.0`, and `pg` `8.17.1`. Its local client factory follows the verified `PrismaPg` adapter pattern and is lazy: no connection is opened for application startup, health checks, or mock-based tests.

## Client generation

1. Use only a local or isolated-test `DATABASE_URL`; never use production or staging credentials.
2. Synchronize the schema from the approved backend revision.
3. Generate the client without connecting to PostgreSQL:

   ```bash
   npm run prisma:generate
   ```

`prisma generate` does not apply migrations. The `migrations/` directory is an unchanged copy of the verified mobile-backend migration history; its 70 migrations were proven against a fresh, dedicated local PostgreSQL 16 database. Never run `prisma db push`, migration, seed, or reset commands against a shared, staging, or production database. `prisma migrate deploy` is allowed only for the explicit localhost integration database documented in the root README.
