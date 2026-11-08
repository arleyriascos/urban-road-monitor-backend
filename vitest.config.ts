import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';

/**
 * TEST_DATABASE_URL may come from the shell or from the .env file (local use). Only that one
 * variable is read from the file, so the real DATABASE_URL and the other secrets never
 * reach the tests.
 */
function testDatabaseUrl(): string | undefined {
  const fromShell = process.env.TEST_DATABASE_URL?.trim();
  if (fromShell) {
    return fromShell;
  }
  if (!existsSync('.env')) {
    return undefined;
  }
  return parseEnv(readFileSync('.env', 'utf8')).TEST_DATABASE_URL?.trim() || undefined;
}

const testUrl = testDatabaseUrl();

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Fake values so modules that read the environment can be imported in tests.
    // They are not secrets and nothing connects to this address.
    env: {
      DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/test_database',
      // The tests that need a real PostgreSQL run only when this is set (see src/test/).
      ...(testUrl ? { TEST_DATABASE_URL: testUrl } : {}),
    },
  },
});
