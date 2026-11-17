import {
  assertIsolatedIntegrationDatabaseUrl,
  ISOLATED_INTEGRATION_DATABASE_URL,
} from './integration-database-safety.js';

describe('integration database safety guard', () => {
  it('accepts only the dedicated localhost integration database', () => {
    expect(assertIsolatedIntegrationDatabaseUrl(ISOLATED_INTEGRATION_DATABASE_URL).hostname).toBe('127.0.0.1');
  });

  it.each([
    'postgresql://yc_fitness_integration:password@db.example.com:5432/yc_fitness_admin_integration',
    'postgresql://yc_fitness_integration:password@127.0.0.1:55432/yc_fitness_production',
    'postgresql://other:password@127.0.0.1:55432/yc_fitness_admin_integration',
    'postgresql://yc_fitness_integration:password@127.0.0.1:5432/yc_fitness_admin_integration',
  ])('rejects unsafe target %s', (databaseUrl) => {
    expect(() => assertIsolatedIntegrationDatabaseUrl(databaseUrl)).toThrow(
      'Integration tests may run only against yc_fitness_admin_integration on localhost port 55432.',
    );
  });
});
