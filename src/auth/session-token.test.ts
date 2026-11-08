import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from './session-token.js';

describe('generateSessionToken', () => {
  it('makes 43 characters of base64url, which is 32 bytes', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('never repeats in a thousand tries', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });

  it('makes tokens that pass the format check', () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
  });
});

describe('hashSessionToken', () => {
  it('matches the published SHA-256 of "abc"', () => {
    expect(hashSessionToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is 64 hexadecimal characters', () => {
    expect(hashSessionToken(generateSessionToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same for the same token and different for another', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(hashSessionToken(generateSessionToken()));
  });

  it('never contains the token itself', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe('isWellFormedSessionToken', () => {
  it.each([
    ['an empty text', ''],
    ['a short text', 'abc'],
    ['44 characters', 'a'.repeat(44)],
    ['42 characters', 'a'.repeat(42)],
    ['a forbidden character', `${'a'.repeat(42)}+`],
    ['a space', `${'a'.repeat(42)} `],
    ['a line break at the end', `${'a'.repeat(43)}\n`],
  ])('rejects %s', (_case, value) => {
    expect(isWellFormedSessionToken(value)).toBe(false);
  });

  it('accepts exactly 43 base64url characters', () => {
    expect(isWellFormedSessionToken('A'.repeat(43))).toBe(true);
    expect(isWellFormedSessionToken(`${'a-_'.repeat(14)}Z`)).toBe(true);
  });
});
