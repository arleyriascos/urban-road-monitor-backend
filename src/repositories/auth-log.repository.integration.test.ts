import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createTestClient,
  createTestUser,
  resetDatabase,
  testDatabaseUrl,
} from '../test/test-database.js';
import { AuthLogRepository } from './auth-log.repository.js';

const url = testDatabaseUrl();
const NOW = new Date('2026-11-10T12:00:00.000Z');

describe.skipIf(!url)('AuthLogRepository (real database)', () => {
  let db: PrismaClient;
  let repository: AuthLogRepository;

  beforeAll(() => {
    db = createTestClient(url!);
    repository = new AuthLogRepository(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function lastRow() {
    const rows = await db.auth_logs.findMany({ orderBy: { id: 'desc' }, take: 1 });
    return rows[0]!;
  }

  it('keeps no IP address for a success, even when it is given', async () => {
    const userId = await createTestUser(db);
    await repository.record({
      userId,
      eventType: 'login',
      success: true,
      ip: '203.0.113.77',
      userAgent: 'Chrome',
      now: NOW,
    });
    expect(await lastRow()).toMatchObject({
      user_id: userId,
      event_type: 'login',
      success: true,
      ip_address: null,
      user_agent: 'Chrome',
      reason: null,
    });
  });

  it('keeps the IP of a failure with its last number cut off', async () => {
    await repository.record({
      eventType: 'login_failed',
      success: false,
      ip: '203.0.113.77',
      reason: 'invalid_token',
      now: NOW,
    });
    expect(await lastRow()).toMatchObject({
      user_id: null,
      ip_address: '203.0.113.0',
      reason: 'invalid_token',
    });
  });

  it('keeps an IPv6 failure cut to its first three groups', async () => {
    await repository.record({
      eventType: 'session_rejected',
      success: false,
      ip: '2001:db8:85a3:8a2e:370:7334:1:2',
      reason: 'expired',
    });
    expect((await lastRow()).ip_address).toBe('2001:db8:85a3::');
  });

  it('stores null when the address is not an IP', async () => {
    await repository.record({
      eventType: 'login_failed',
      success: false,
      ip: 'not an ip',
      reason: 'invalid_token',
    });
    expect((await lastRow()).ip_address).toBeNull();
  });

  it('cuts the user agent to 255 characters', async () => {
    await repository.record({
      eventType: 'logout',
      success: true,
      userAgent: 'x'.repeat(600),
    });
    expect((await lastRow()).user_agent).toHaveLength(255);
  });

  it('uses the time it is given', async () => {
    await repository.record({ eventType: 'logout', success: true, now: NOW });
    expect((await lastRow()).created_at).toEqual(NOW);
  });

  it.each([
    ['an email', 'ana@example.com'],
    ['a token', 'A'.repeat(43)],
    ['capital letters', 'Expired'],
    ['a space', 'not valid'],
    ['more than 40 characters', 'a'.repeat(41)],
    ['an empty text', ''],
  ])('refuses a reason that is %s, and writes nothing', async (_case, reason) => {
    await expect(
      repository.record({ eventType: 'login_failed', success: false, reason }),
    ).rejects.toThrow();
    expect(await db.auth_logs.count()).toBe(0);
  });
});
