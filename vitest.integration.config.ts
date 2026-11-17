import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/tests/integration-setup.ts'],
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
  },
});
