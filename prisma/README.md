# Prisma consumer boundary

`ycfitness-api` on `feature/modify` is the current authoritative owner of the shared
PostgreSQL schema and Prisma migration history. `yc-fitness-admin-api` consumes that
schema; it must not independently create, rewrite, or deploy shared migrations.

## Schema synchronization

`schema.prisma` is the current authoritative schema plus explicitly marked Admin
attendance proposals. To check a sibling checkout:

```bash
npm run schema:check
```

For a checkout elsewhere:

```bash
YC_FITNESS_API_PATH=/absolute/path/to/ycfitness-api npm run schema:check
# or
node scripts/check-prisma-schema-drift.mjs --authoritative /absolute/path/to/ycfitness-api
```

The checker reads both files and never writes a repository or database. It compares
authoritative models/enums declaration-by-declaration, rejects missing or changed
authoritative declarations, rejects untracked Admin-only blocks, and verifies the
exact allowed proposal fields.

When synchronizing manually:

1. Start from `ycfitness-api/prisma/schema.prisma`.
2. Preserve only the proposals marked `@admin-proposal` in the Admin schema.
3. Run `npm run schema:check`.
4. Run `npm run prisma:generate` only with a local/development configuration.
5. Do not create a migration here. An accepted database change must be authored in
   `ycfitness-api` by its owner.

## Migration safety

- `prisma.config.ts` points migration commands to `prisma/migrations-disabled/`, an
  intentionally empty directory.
- `prisma/migrations/` is retained only as an audit snapshot. It is neither complete
  nor safe to deploy.
- `prisma/proposals/` contains reviewable Admin-only experimental SQL outside Prisma's
  deployable migration layout.
- Never use `migrate dev`, `migrate deploy`, `db push`, `migrate reset`, or seeds from
  this repository against a shared, staging, or production database.

The snapshot contains a known same-name history conflict:
`20260804140000_add_payment_status_draft/migration.sql` differs from the authoritative
file. The Admin snapshot uses `ALTER TYPE ... ADD VALUE`; the authoritative migration
recreates the enum before assigning the new default. Do not edit either historical
file to hide the mismatch. Only the authoritative history may be deployed.

The dedicated localhost integration database may be built using the authoritative
repository's migration history, followed by the quarantined attendance proposal SQL,
as documented in the root README. This local procedure does not grant authority to
deploy the proposals elsewhere.

## Dependency versions

Current versions are Prisma CLI `7.5.0`, `@prisma/client` `7.3.0`, and
`@prisma/adapter-pg` `7.3.0`. They are intentionally unchanged here. Align all three
to one separately validated version in a dedicated dependency task.
