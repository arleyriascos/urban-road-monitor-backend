import { describe, expect, it } from 'vitest';
import { assertSeedAllowed, type SeedGuardInput } from './guards.js';

const allowed: SeedGuardInput = {
  nodeEnv: 'development',
  allowedHost: 'ep-dev-123456.us-east-1.aws.neon.tech',
  targetHost: 'ep-dev-123456.us-east-1.aws.neon.tech',
  detections: 0,
};

describe('assertSeedAllowed', () => {
  it('allows the declared server without detections', () => {
    expect(() => assertSeedAllowed(allowed)).not.toThrow();
  });

  it('ignores the port and the letter case when comparing servers', () => {
    expect(() =>
      assertSeedAllowed({
        ...allowed,
        allowedHost: 'EP-DEV-123456.us-east-1.aws.neon.tech',
        targetHost: 'ep-dev-123456.us-east-1.aws.neon.tech:5432',
      }),
    ).not.toThrow();
  });

  it('refuses in production', () => {
    expect(() => assertSeedAllowed({ ...allowed, nodeEnv: 'production' })).toThrow('production');
  });

  it('refuses when SEED_ALLOWED_HOST is missing or blank', () => {
    expect(() => assertSeedAllowed({ ...allowed, allowedHost: undefined })).toThrow(
      'SEED_ALLOWED_HOST',
    );
    expect(() => assertSeedAllowed({ ...allowed, allowedHost: '  ' })).toThrow('SEED_ALLOWED_HOST');
  });

  it('refuses a server that is not the declared one and names both', () => {
    const attempt = () => assertSeedAllowed({ ...allowed, targetHost: 'ep-main-999999.neon.tech' });
    expect(attempt).toThrow('ep-main-999999.neon.tech');
    expect(attempt).toThrow('ep-dev-123456');
  });

  it('refuses when the database already has real detections', () => {
    expect(() => assertSeedAllowed({ ...allowed, detections: 4 })).toThrow('4 detecciones');
  });

  it('checks production before anything else', () => {
    expect(() =>
      assertSeedAllowed({ ...allowed, nodeEnv: 'production', allowedHost: undefined }),
    ).toThrow('production');
  });
});
