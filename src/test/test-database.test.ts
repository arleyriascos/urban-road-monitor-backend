import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeTestDatabase, testDatabaseUrl } from './test-database.js';

describe('assertSafeTestDatabase', () => {
  it.each([
    'postgresql://postgres:secret@localhost:5432/urban_road_monitor_test',
    'postgres://postgres:secret@127.0.0.1:5432/anything_test',
    'postgresql://postgres:secret@[::1]:5432/db_test?sslmode=disable',
  ])('accepts %s', (url) => {
    expect(() => assertSafeTestDatabase(url)).not.toThrow();
  });

  it.each([
    [
      'a Neon host',
      'postgresql://app_user:x@ep-cool-123.us-east-2.aws.neon.tech/urban_road_monitor_test',
    ],
    ['another computer', 'postgresql://postgres:x@10.0.0.5:5432/urban_road_monitor_test'],
    ['the development name', 'postgresql://postgres:x@localhost:5432/urban_road_monitor'],
    [
      'a name that only contains test',
      'postgresql://postgres:x@localhost:5432/test_urban_road_monitor',
    ],
    [
      'a name that ends in test without the underscore',
      'postgresql://postgres:x@localhost:5432/urbantest',
    ],
    ['no database name', 'postgresql://postgres:x@localhost:5432'],
    ['another protocol', 'mysql://root:x@localhost:3306/urban_road_monitor_test'],
    ['a text that is not an address', 'not a url'],
  ])('refuses %s', (_case, url) => {
    expect(() => assertSafeTestDatabase(url)).toThrow();
  });

  it('does not put the password in the error message', () => {
    try {
      assertSafeTestDatabase(
        'postgresql://postgres:topsecret@db.example.com/urban_road_monitor_test',
      );
    } catch (error) {
      expect(String(error)).not.toContain('topsecret');
    }
  });
});

describe('testDatabaseUrl', () => {
  const original = process.env.TEST_DATABASE_URL;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = original;
    }
  });

  it('is undefined when the variable is missing or blank', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(testDatabaseUrl()).toBeUndefined();
    process.env.TEST_DATABASE_URL = '   ';
    expect(testDatabaseUrl()).toBeUndefined();
  });

  it('returns the address when it is set', () => {
    process.env.TEST_DATABASE_URL = ' postgresql://postgres:x@localhost:5432/a_test ';
    expect(testDatabaseUrl()).toBe('postgresql://postgres:x@localhost:5432/a_test');
  });
});
