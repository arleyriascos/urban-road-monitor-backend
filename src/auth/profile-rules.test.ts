import { describe, expect, it } from 'vitest';
import {
  AVATAR_URL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  cleanAvatarUrl,
  cleanName,
  nameForNewAccount,
  profileUpdateFrom,
} from './profile-rules.js';

describe('cleanName', () => {
  it('keeps a normal name, accents included', () => {
    expect(cleanName('Ana María Pérez')).toBe('Ana María Pérez');
  });

  it('trims it and collapses the spaces inside', () => {
    expect(cleanName('  Ana   María \t Pérez  ')).toBe('Ana María Pérez');
  });

  it('turns line breaks and other control characters into spaces', () => {
    expect(cleanName('Ana\nPérez\u0000')).toBe('Ana Pérez');
  });

  it('drops the characters that change the direction of the text', () => {
    expect(cleanName('Ana \u202Eoediv\u202C Pérez')).toBe('Ana oediv Pérez');
  });

  it('cuts it to 150 characters', () => {
    const cut = cleanName('a'.repeat(400));
    expect(cut).toHaveLength(FULL_NAME_MAX_LENGTH);
  });

  it('counts an emoji as one character and never splits it', () => {
    const name = '😀'.repeat(200);
    const cut = cleanName(name);
    expect(Array.from(cut ?? '')).toHaveLength(FULL_NAME_MAX_LENGTH);
    expect(cut).toBe('😀'.repeat(FULL_NAME_MAX_LENGTH));
  });

  it('does not leave a space at the end after cutting', () => {
    const name = `${'a'.repeat(149)} bbbb`;
    expect(cleanName(name)).toBe('a'.repeat(149));
  });

  it.each([undefined, '', '   ', '\n\t', '\u202E'])('is undefined for %j', (name) => {
    expect(cleanName(name)).toBeUndefined();
  });
});

describe('nameForNewAccount', () => {
  it('uses the name Google sent', () => {
    expect(nameForNewAccount('Ana Pérez', 'ana.perez@example.com')).toBe('Ana Pérez');
  });

  it('uses the part of the email before the @ when there is no name', () => {
    expect(nameForNewAccount(undefined, 'ana.perez@example.com')).toBe('ana.perez');
    expect(nameForNewAccount('   ', 'ana.perez@example.com')).toBe('ana.perez');
  });

  it('cuts that part too if the email is very long', () => {
    const email = `${'x'.repeat(200)}@example.com`;
    expect(nameForNewAccount(undefined, email)).toHaveLength(FULL_NAME_MAX_LENGTH);
  });

  it('never returns an empty name, because full_name cannot be empty', () => {
    expect(nameForNewAccount(undefined, '\u0001@example.com')).toBe('Usuario');
  });
});

describe('cleanAvatarUrl', () => {
  it('keeps a Google photo address as it came', () => {
    const url = 'https://lh3.googleusercontent.com/a/ACg8ocJ=s96-c';
    expect(cleanAvatarUrl(url)).toBe(url);
    expect(cleanAvatarUrl(`  ${url} `)).toBe(url);
  });

  it.each([
    ['http', 'http://lh3.googleusercontent.com/a/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['file:', 'file:///etc/passwd'],
    ['a relative path', '/images/a.png'],
    ['no scheme', 'lh3.googleusercontent.com/a/x'],
    ['a user and password', 'https://user:secret@example.com/a.png'],
    ['a user alone', 'https://user@example.com/a.png'],
    ['a space inside', 'https://example.com/a b.png'],
    ['a line break inside', 'https://example.com/a\n.png'],
    ['a backslash', 'https://example.com\\@evil.com/a.png'],
    ['no host', 'https:///a.png'],
    ['not an address', 'not a url'],
  ])('is null for %s', (_name, url) => {
    expect(cleanAvatarUrl(url)).toBeNull();
  });

  it.each([undefined, '', '   '])('is null for %j', (url) => {
    expect(cleanAvatarUrl(url)).toBeNull();
  });

  it('accepts exactly 2048 characters and refuses one more', () => {
    const base = 'https://example.com/';
    const ok = base + 'a'.repeat(AVATAR_URL_MAX_LENGTH - base.length);
    expect(ok).toHaveLength(AVATAR_URL_MAX_LENGTH);
    expect(cleanAvatarUrl(ok)).toBe(ok);
    expect(cleanAvatarUrl(`${ok}a`)).toBeNull();
  });
});

describe('profileUpdateFrom', () => {
  const photo = 'https://lh3.googleusercontent.com/a/x=s96-c';

  it('takes the name and the photo Google sent', () => {
    expect(profileUpdateFrom(' Ana  Pérez ', photo)).toEqual({
      fullName: 'Ana Pérez',
      avatarUrl: photo,
    });
  });

  it('leaves the name out when Google sent none, so the stored one stays', () => {
    const update = profileUpdateFrom(undefined, photo);
    expect(update).toEqual({ avatarUrl: photo });
    expect('fullName' in update).toBe(false);
    expect('fullName' in profileUpdateFrom('   ', photo)).toBe(false);
  });

  it('sets the photo to null when Google sent none or an unsafe one', () => {
    expect(profileUpdateFrom('Ana', undefined)).toEqual({ fullName: 'Ana', avatarUrl: null });
    expect(profileUpdateFrom('Ana', 'http://example.com/a.png').avatarUrl).toBeNull();
  });
});
