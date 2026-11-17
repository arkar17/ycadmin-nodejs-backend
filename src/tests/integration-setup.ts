import {
  assertIsolatedIntegrationDatabaseUrl,
  ISOLATED_INTEGRATION_DATABASE_URL,
} from './integration-database-safety.js';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-thirty-two-characters';
process.env.JWT_EXPIRES_IN = '1h';
// Deliberately replace, rather than read, the normal application DATABASE_URL.
// dotenv does not override this value later during module initialization.
process.env.DATABASE_URL = ISOLATED_INTEGRATION_DATABASE_URL;
assertIsolatedIntegrationDatabaseUrl(process.env.DATABASE_URL);
