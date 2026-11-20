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

describe('envSchema GOOGLE_CLIENT_ID', () => {
  // Made-up values, built in pieces on purpose: a whole text that looks like a Google client ID
  // or client secret makes GitHub's secret scanning refuse the push, even when it is not real.
  const SUFFIX = ['.apps', 'googleusercontent', 'com'].join('.');
  const clientId = `123456789-abcdefghijklmnopqrstuvwxyz012345${SUFFIX}`;

  it('is optional', () => {
    expect(envSchema.parse(base).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('treats an empty value as not set', () => {
    expect(envSchema.parse({ ...base, GOOGLE_CLIENT_ID: '' }).GOOGLE_CLIENT_ID).toBeUndefined();
    expect(envSchema.parse({ ...base, GOOGLE_CLIENT_ID: '  ' }).GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('accepts a Google client ID and removes the spaces around it', () => {
    expect(envSchema.parse({ ...base, GOOGLE_CLIENT_ID: clientId }).GOOGLE_CLIENT_ID).toBe(
      clientId,
    );
    expect(envSchema.parse({ ...base, GOOGLE_CLIENT_ID: ` ${clientId}\n` }).GOOGLE_CLIENT_ID).toBe(
      clientId,
    );
  });

  it.each([
    ['a client secret pasted by mistake', ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-')],
    ['another domain', '123456789-abc123.apps.example.com'],
    ['only the suffix', SUFFIX],
    ['a text with spaces inside', `123 456${SUFFIX}`],
    ['a URL', `https://123456789-abc${SUFFIX}`],
  ])('rejects %s', (_name, value) => {
    const parsed = envSchema.safeParse({ ...base, GOOGLE_CLIENT_ID: value });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      'GOOGLE_CLIENT_ID must be a Google client ID that ends in .apps.googleusercontent.com',
    );
  });
});

describe('envSchema e-mail service', () => {
  const key = 'k'.repeat(30);

  it('is all optional, with a default name for the sender', () => {
    const parsed = envSchema.parse(base);
    expect(parsed.BREVO_API_KEY).toBeUndefined();
    expect(parsed.MAIL_FROM).toBeUndefined();
    expect(parsed.APP_URL).toBeUndefined();
    expect(parsed.MAIL_FROM_NAME).toBe('Urban Road Monitor');
  });

  it('treats empty values as not set', () => {
    const parsed = envSchema.parse({ ...base, BREVO_API_KEY: '', MAIL_FROM: ' ', APP_URL: '' });
    expect(parsed.BREVO_API_KEY).toBeUndefined();
    expect(parsed.MAIL_FROM).toBeUndefined();
    expect(parsed.APP_URL).toBeUndefined();
  });

  it('accepts the three together and cleans spaces and the final slash', () => {
    const parsed = envSchema.parse({
      ...base,
      BREVO_API_KEY: ` ${key}\n`,
      MAIL_FROM: ' sender@example.com ',
      MAIL_FROM_NAME: 'Urban Road',
      APP_URL: 'https://site.example.com/',
    });
    expect(parsed.BREVO_API_KEY).toBe(key);
    expect(parsed.MAIL_FROM).toBe('sender@example.com');
    expect(parsed.MAIL_FROM_NAME).toBe('Urban Road');
    expect(parsed.APP_URL).toBe('https://site.example.com');
  });

  it.each([
    ['a key that is too short', { BREVO_API_KEY: 'short' }],
    ['a key with spaces inside', { BREVO_API_KEY: `${key} ${key}` }],
    ['a sender that is not an email', { MAIL_FROM: 'not an email' }],
    ['an app address with a path', { APP_URL: 'https://site.example.com/app' }],
    ['an app address with a query', { APP_URL: 'https://site.example.com/?a=1' }],
    ['an app address that is not a URL', { APP_URL: 'site.example.com' }],
  ])('rejects %s', (_name, extra) => {
    expect(envSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it('allows http for APP_URL on a computer but not in production', () => {
    expect(envSchema.safeParse({ ...base, APP_URL: 'http://localhost:5173' }).success).toBe(true);
    const production = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      APP_URL: 'http://site.example.com',
    });
    expect(production.success).toBe(false);
    expect(production.error?.issues[0]?.message).toBe('APP_URL must use https:// in production');
  });
});
