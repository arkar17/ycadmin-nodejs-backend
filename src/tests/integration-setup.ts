process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-thirty-two-characters';
process.env.JWT_EXPIRES_IN = '1h';
process.env.DATABASE_URL =
  'postgresql://yc_fitness_integration:yc_fitness_integration_local_only@127.0.0.1:55432/yc_fitness_admin_integration?schema=public';
