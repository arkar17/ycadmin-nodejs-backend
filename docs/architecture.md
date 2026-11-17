# Architecture boundary

The application exposes versioned routes beneath `/api/admin/v1`. It currently registers only `GET /health`; that endpoint is intentionally database-independent.

Each planned domain has a module directory, but no feature router, controller, repository, database query, mock record, or business workflow has been implemented. This keeps the codebase ready for incremental feature work without claiming a data contract that has not been verified in the shared mobile backend.

Cross-cutting infrastructure is centralized as follows:

- `config/`: validated environment configuration and redacted structured logging.
- `middleware/`: Zod validation, JWT verification scaffold, not-found and error handling.
- `shared/`: success envelopes, pagination type, and application errors.
- `database/`: lazy, schema-free Prisma Client factory; it never connects at startup.
- `routes/`: API version boundary and future router registration.
