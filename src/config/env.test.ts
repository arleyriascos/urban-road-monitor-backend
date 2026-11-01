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
