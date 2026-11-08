import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Support for the tests that need a real PostgreSQL.
 *
 * They run only when TEST_DATABASE_URL is set, and only against a database on this very
 * computer whose name ends in "_test": the tests empty tables, so they must never be able
 * to touch Neon or any other shared database.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The test database address, or undefined when the integration tests should be skipped. */
export function testDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL?.trim();
  return value ? value : undefined;
}

/**
 * Throws unless the address points to a local database named "something_test".
 * Neon addresses, other hosts and the development or production names are refused.
 */
export function assertSafeTestDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid address');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_URL must be a PostgreSQL connection string');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `TEST_DATABASE_URL must point to this computer (localhost), not to "${parsed.hostname}"`,
    );
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!name.endsWith('_test')) {
    throw new Error(`The test database name must end in "_test", not "${name}"`);
  }
}

/** A client for the test database. The tests must call $disconnect() when they finish. */
export function createTestClient(url: string): PrismaClient {
  assertSafeTestDatabase(url);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Empties every table the authentication tests touch, and the ones that depend on them. */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
}

let counter = 0;

/** Inserts a user and returns its id. The email is unique and in lowercase. */
export async function createTestUser(
  db: PrismaClient,
  overrides: { email?: string; isActive?: boolean } = {},
): Promise<string> {
  counter += 1;
  const isActive = overrides.isActive ?? true;
  const user = await db.users.create({
    data: {
      email: overrides.email ?? `user${counter}@example.com`,
      full_name: `Test User ${counter}`,
      is_active: isActive,
      deleted_at: isActive ? null : new Date('2026-01-01T00:00:00Z'),
    },
    select: { id: true },
  });
  return user.id;
}
