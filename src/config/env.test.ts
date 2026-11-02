import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const base = { DATABASE_URL: 'postgresql://user:password@localhost:5432/database' };
const token = 'a'.repeat(64);

describe('envSchema INTERNAL_TOKEN', () => {
  it('is optional', () => {
    const parsed = envSchema.parse(base);
    expect(parsed.INTERNAL_TOKEN).toBeUndefined();
  });

  it('treats an empty value as not set', () => {
    expect(envSchema.parse({ ...base, INTERNAL_TOKEN: '' }).INTERNAL_TOKEN).toBeUndefined();
    expect(envSchema.parse({ ...base, INTERNAL_TOKEN: '   ' }).INTERNAL_TOKEN).toBeUndefined();
  });

  it('accepts a token of at least 32 characters', () => {
    expect(envSchema.parse({ ...base, INTERNAL_TOKEN: token }).INTERNAL_TOKEN).toBe(token);
    expect(envSchema.parse({ ...base, INTERNAL_TOKEN: 'b'.repeat(32) }).INTERNAL_TOKEN).toBe(
      'b'.repeat(32),
    );
  });

  it('removes spaces around the token', () => {
    expect(envSchema.parse({ ...base, INTERNAL_TOKEN: `  ${token}\n` }).INTERNAL_TOKEN).toBe(token);
  });

  it('rejects a token that is too short', () => {
    const parsed = envSchema.safeParse({ ...base, INTERNAL_TOKEN: 'short-token' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      'INTERNAL_TOKEN must have at least 32 characters',
    );
  });
});

describe('envSchema AI_SERVICE_URL', () => {
  it('is optional', () => {
    expect(envSchema.parse(base).AI_SERVICE_URL).toBeUndefined();
    expect(envSchema.parse({ ...base, AI_SERVICE_URL: '' }).AI_SERVICE_URL).toBeUndefined();
  });

  it('removes the trailing slash', () => {
    const parsed = envSchema.parse({ ...base, AI_SERVICE_URL: ' https://ai.example.com/ ' });
    expect(parsed.AI_SERVICE_URL).toBe('https://ai.example.com');
  });

  it.each([
    'ai.example.com',
    'ftp://ai.example.com',
    'https://user:secret@ai.example.com',
    'https://ai.example.com/?debug=1',
    'https://ai.example.com/#x',
  ])('rejects %s', (url) => {
    expect(envSchema.safeParse({ ...base, AI_SERVICE_URL: url }).success).toBe(false);
  });

  it('requires https in production, because the call carries the token', () => {
    const parsed = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      AI_SERVICE_URL: 'http://ai.example.com',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('AI_SERVICE_URL must use https:// in production');
  });

  it('allows a local http service in development', () => {
    const parsed = envSchema.parse({ ...base, AI_SERVICE_URL: 'http://localhost:8000' });
    expect(parsed.AI_SERVICE_URL).toBe('http://localhost:8000');
  });
});

describe('envSchema ROUTE_CACHE_CAPACITY', () => {
  it('is 200 by default', () => {
    expect(envSchema.parse(base).ROUTE_CACHE_CAPACITY).toBe(200);
  });

  it('reads a whole number from the environment', () => {
    expect(envSchema.parse({ ...base, ROUTE_CACHE_CAPACITY: '500' }).ROUTE_CACHE_CAPACITY).toBe(
      500,
    );
  });

  it.each(['0', '-1', '10001', '2.5', 'many'])('rejects %s', (capacity) => {
    expect(envSchema.safeParse({ ...base, ROUTE_CACHE_CAPACITY: capacity }).success).toBe(false);
  });
});
