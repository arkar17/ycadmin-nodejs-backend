# Historical snapshot — do not deploy

This directory is retained for audit context only. It is not the configured Prisma
migration path and is not authoritative, complete, or safe to execute.

`ycfitness-api` owns the shared migration history. In particular, the SQL here at
`20260804140000_add_payment_status_draft/migration.sql` differs from the authoritative
migration with the same name, so using this snapshot can produce checksum/history
conflicts. The Admin-only attendance SQL has been removed from this layout and retained
under `prisma/proposals/attendance/migrations/`.

See `prisma/README.md` for ownership, synchronization, and isolated-test guidance.
