# Provisional attendance schema proposal

This directory contains Admin-only experimental SQL. It is not part of the
authoritative shared migration history and must never be deployed to a shared,
staging, or production database from this repository.

The proposal currently covers:

- `AttendanceSource` and `Attendance.source`;
- `AttendanceQrCredential` and its status enum/relations;
- a database-enforced rolling 60-minute attendance window;
- database-derived UTC timestamps and Asia/Yangon compatibility dates.

The four SQL files were moved out of `prisma/migrations/` so Prisma cannot treat
them as deployable shared migrations. They are retained for review and for the
explicitly isolated localhost integration database only. The mobile API owner
must review, re-author, and add any accepted design to `ycfitness-api` under a
new authoritative migration. Do not copy these files into shared history.

The corresponding Prisma declarations remain in `prisma/schema.prisma` and are
marked with `@admin-proposal` comments because the current Admin implementation
still compiles against them. `npm run schema:check` permits only the proposal
deltas enumerated in its manifest; all other authoritative drift fails.
