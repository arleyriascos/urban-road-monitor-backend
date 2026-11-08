import { describe, expect, it } from 'vitest';
import {
  GOOGLE_TOKEN_CLOCK_SKEW_S,
  GOOGLE_TOKEN_MAX_AGE_S,
  checkGoogleIdentity,
  normalizeEmail,
} from './google-identity.js';
import type { GoogleTokenClaims } from './google-token-verifier.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const nowS = Math.floor(NOW.getTime() / 1000);

function claims(overrides: Partial<GoogleTokenClaims> = {}): GoogleTokenClaims {
  return {
    subject: '110169484474386276334',
    email: 'ana@example.com',
    emailVerified: true,
    name: 'Ana Pérez',
    picture: 'https://lh3.googleusercontent.com/a/ana=s96-c',
    issuedAt: nowS - 5,
    ...overrides,
  };
}

describe('checkGoogleIdentity', () => {
  it('accepts a good token and returns who it identifies', () => {
    expect(checkGoogleIdentity(claims(), NOW)).toEqual({
      ok: true,
      identity: {
        subject: '110169484474386276334',
        email: 'ana@example.com',
        name: 'Ana Pérez',
        picture: 'https://lh3.googleusercontent.com/a/ana=s96-c',
      },
    });
  });

  it('keeps the name and the photo optional', () => {
    const result = checkGoogleIdentity(claims({ name: undefined, picture: undefined }), NOW);
    expect(result).toMatchObject({ ok: true, identity: { name: undefined, picture: undefined } });
  });

  describe('who the token says it is', () => {
    it.each([
      ['no subject', { subject: undefined }],
      ['an empty subject', { subject: '' }],
      ['a subject with a space', { subject: '1101 6948' }],
      ['a subject of 256 characters', { subject: '1'.repeat(256) }],
      ['no email', { email: undefined }],
      ['an empty email', { email: '' }],
      ['an email without @', { email: 'ana.example.com' }],
      ['an email without a dot after the @', { email: 'ana@example' }],
      ['an email with two @', { email: 'a@b@example.com' }],
      ['an email with a space inside', { email: 'a na@example.com' }],
      ['an email with letters outside ASCII', { email: 'ánna@example.com' }],
      ['an email of more than 255 characters', { email: `${'a'.repeat(250)}@example.com` }],
    ] as const)('refuses %s as invalid_token', (_name, overrides) => {
      expect(checkGoogleIdentity(claims(overrides), NOW)).toEqual({
        ok: false,
        reason: 'invalid_token',
      });
    });

    it('accepts a subject of exactly 255 characters', () => {
      const result = checkGoogleIdentity(claims({ subject: '7'.repeat(255) }), NOW);
      expect(result.ok).toBe(true);
    });
  });

  describe('the email', () => {
    it('is turned into lowercase and trimmed, because the table demands it', () => {
      const result = checkGoogleIdentity(claims({ email: '  Ana.Perez@Example.COM ' }), NOW);
      expect(result).toMatchObject({ ok: true, identity: { email: 'ana.perez@example.com' } });
    });

    it.each([false, undefined])('is refused as email_unverified when emailVerified is %s', (v) => {
      expect(checkGoogleIdentity(claims({ emailVerified: v }), NOW)).toEqual({
        ok: false,
        reason: 'email_unverified',
      });
    });

    it('is checked before the age: an old token with an unverified email says email_unverified', () => {
      const result = checkGoogleIdentity(
        claims({ emailVerified: false, issuedAt: nowS - 3600 }),
        NOW,
      );
      expect(result).toEqual({ ok: false, reason: 'email_unverified' });
    });
  });

  describe('how old the token is', () => {
    it('accepts a token of exactly 10 minutes and refuses one second more', () => {
      expect(checkGoogleIdentity(claims({ issuedAt: nowS - GOOGLE_TOKEN_MAX_AGE_S }), NOW).ok).toBe(
        true,
      );
      expect(
        checkGoogleIdentity(claims({ issuedAt: nowS - GOOGLE_TOKEN_MAX_AGE_S - 1 }), NOW),
      ).toEqual({ ok: false, reason: 'token_too_old' });
    });

    it('refuses a token issued an hour ago, as Google would still accept it', () => {
      expect(checkGoogleIdentity(claims({ issuedAt: nowS - 3600 }), NOW)).toEqual({
        ok: false,
        reason: 'token_too_old',
      });
    });

    it('counts a token without "iat" as too old', () => {
      expect(checkGoogleIdentity(claims({ issuedAt: undefined }), NOW)).toEqual({
        ok: false,
        reason: 'token_too_old',
      });
    });

    it('accepts a token issued up to 60 seconds ahead of our clock and refuses one more', () => {
      expect(
        checkGoogleIdentity(claims({ issuedAt: nowS + GOOGLE_TOKEN_CLOCK_SKEW_S }), NOW).ok,
      ).toBe(true);
      expect(
        checkGoogleIdentity(claims({ issuedAt: nowS + GOOGLE_TOKEN_CLOCK_SKEW_S + 1 }), NOW),
      ).toEqual({ ok: false, reason: 'invalid_token' });
    });

    it('uses the clock it is given, not the real one', () => {
      const later = new Date(NOW.getTime() + 11 * 60 * 1000);
      expect(checkGoogleIdentity(claims(), later)).toEqual({ ok: false, reason: 'token_too_old' });
    });
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ana@Example.com\n')).toBe('ana@example.com');
  });
});
