import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Fake values so modules that read the environment can be imported in tests.
    // They are not secrets and nothing connects to this address.
    env: {
      DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/test_database',
    },
  },
});
