# Architecture boundary

The application exposes versioned routes beneath `/api/admin/v1`. `GET /health` is intentionally database-independent; schema-backed feature routers are registered through the Admin composition root.

Implemented domains use router/controller/service/repository/schema boundaries. New business workflows remain gated on verified shared contracts rather than being inferred from frontend fields.

Cross-cutting infrastructure is centralized as follows:

- `config/`: validated environment configuration and redacted structured logging.
- `middleware/`: Zod validation, JWT verification scaffold, not-found and error handling.
- `shared/`: success envelopes, pagination type, and application errors.
- `database/`: lazy, schema-free Prisma Client factory; it never connects at startup.
- `routes/`: API version boundary and future router registration.

## Database ownership

`ycfitness-api` owns the shared Prisma schema migrations. This repository consumes its
schema, keeps Admin-only proposals explicitly marked and quarantined, and configures an
empty migration path so its historical snapshot cannot be deployed accidentally. Run
`npm run schema:check` before schema-backed development and see `prisma/README.md` for
the synchronization process.
