export const ISOLATED_INTEGRATION_DATABASE_URL =
  'postgresql://yc_fitness_integration:yc_fitness_integration_local_only@127.0.0.1:55432/yc_fitness_admin_integration?schema=public';

const ALLOWED_INTEGRATION_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Must be called before constructing any database client in integration tests. */
export const assertIsolatedIntegrationDatabaseUrl = (value: string | undefined): URL => {
  if (!value) throw new Error('The isolated integration database URL is required.');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The isolated integration database URL is invalid.');
  }

  const databaseName = url.pathname.slice(1);
  const isClearlyTestDatabase = /(?:integration|test)/i.test(databaseName);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol)
    || !ALLOWED_INTEGRATION_HOSTS.has(url.hostname)
    || url.port !== '55432'
    || databaseName !== 'yc_fitness_admin_integration'
    || !isClearlyTestDatabase
    || url.username !== 'yc_fitness_integration'
  ) {
    throw new Error(
      'Integration tests may run only against yc_fitness_admin_integration on localhost port 55432.',
    );
  }

  return url;
};
