import { describe, expect, it } from 'vitest';
import {
  EMAIL_TOKEN_TTL_MS,
  generateEmailToken,
  hashEmailToken,
  isWellFormedEmailToken,
} from './email-token.js';

describe('e-mail tokens', () => {
  it('makes a different well-formed token each time', () => {
    const a = generateEmailToken();
    expect(isWellFormedEmailToken(a)).toBe(true);
    expect(a).not.toBe(generateEmailToken());
  });

  it('stores a SHA-256 in hexadecimal that is not the token', () => {
    const token = generateEmailToken();
    const hash = hashEmailToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it('refuses texts that cannot be a token', () => {
    for (const value of ['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}!`, ' '.repeat(43)]) {
      expect(isWellFormedEmailToken(value)).toBe(false);
    }
  });

  it('gives a recovery link less time than a verification link', () => {
    expect(EMAIL_TOKEN_TTL_MS.reset_password).toBe(60 * 60 * 1000);
    expect(EMAIL_TOKEN_TTL_MS.verify_email).toBe(24 * 60 * 60 * 1000);
  });
});
