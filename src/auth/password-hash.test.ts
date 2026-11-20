import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstNothing, verifyPassword } from './password-hash.js';

describe('hashPassword', () => {
  it('stores the parameters, a salt and a hash, and never the password', async () => {
    const hash = await hashPassword('a long enough password');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain('a long enough password');
    expect(hash.length).toBeLessThanOrEqual(255);
  });

  it('uses a new salt every time', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same password 1'),
      hashPassword('same password 1'),
    ]);
    expect(first).not.toBe(second);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects any other', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('treats the same text written in two Unicode forms as the same password', async () => {
    const hash = await hashPassword('contraseña-larga');
    expect(await verifyPassword('contraseña-larga'.replace('ñ', 'ñ'), hash)).toBe(true);
    expect(await verifyPassword('contraseña-larga', hash)).toBe(true);
  });

  it('answers no, and never throws, for a malformed or dangerous hash', async () => {
    for (const stored of [
      '',
      'plain text',
      'bcrypt$10$abc$def',
      'scrypt$16384$8$1$onlyfive',
      'scrypt$abc$8$1$c2FsdA$aGFzaA',
      'scrypt$16385$8$1$c2FsdA$aGFzaA',
      'scrypt$1073741824$8$1$c2FsdA$aGFzaA',
      'scrypt$16384$8$99$c2FsdA$aGFzaA',
      'scrypt$16384$8$1$$',
    ]) {
      expect(await verifyPassword('anything long', stored)).toBe(false);
    }
  });

  it('keeps checking hashes made with other parameters', async () => {
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const key = scryptSync('old parameters', salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = `scrypt$1024$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
    expect(await verifyPassword('old parameters', stored)).toBe(true);
    expect(await verifyPassword('other', stored)).toBe(false);
  });
});

describe('verifyAgainstNothing', () => {
  it('always answers false', async () => {
    expect(await verifyAgainstNothing('whatever')).toBe(false);
  });
});
