/**
 * What is copied from Google to the account, and how it is cleaned before it is stored.
 * These are pure functions: the database columns are users.full_name (150 characters) and
 * users.avatar_url, and the avatar ends up inside an <img> in the browser, so it must not be
 * able to carry anything but a plain https address.
 */
export const FULL_NAME_MAX_LENGTH = 150;
export const AVATAR_URL_MAX_LENGTH = 2048;

/** Used only when not even the email gives a usable name. */
const NAME_OF_LAST_RESORT = 'Usuario';

/** Cuts a text to `max` characters, counting each emoji as one so none is split in half. */
function cut(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max ? characters.slice(0, max).join('') : text;
}

/**
 * Control characters (tabs, line breaks...) become spaces, the characters that flip the
 * direction of the text are dropped (they can make a name read backwards), and the spaces are
 * collapsed and trimmed.
 */
function tidy(text: string): string {
  return text
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The name Google sent, cleaned and cut to 150 characters. Undefined if nothing is left. */
export function cleanName(name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const clean = cut(tidy(name), FULL_NAME_MAX_LENGTH).trim();
  return clean === '' ? undefined : clean;
}

/**
 * The name for an account that does not exist yet: Google's name, or, if it did not send
 * one, the part of the email before the "@".
 */
export function nameForNewAccount(name: string | undefined, email: string): string {
  return cleanName(name) ?? cleanName(email.split('@')[0]) ?? cleanName(NAME_OF_LAST_RESORT) ?? '';
}

/**
 * The photo address Google sent, or null if it cannot be trusted: it must be an https address
 * of at most 2048 characters, with a host, without user or password and without spaces or
 * control characters. Anything else (http, javascript:, data:, a huge text) becomes null.
 */
export function cleanAvatarUrl(picture: string | undefined): string | null {
  const text = picture?.trim();
  if (!text || text.length > AVATAR_URL_MAX_LENGTH) {
    return null;
  }
  if (/[\s\p{Cc}\\]/u.test(text)) {
    return null;
  }
  // "https://" and then a host right away: the URL parser would read "https:///a.png" as the
  // host "a.png", but what is stored must be exactly what a browser will use.
  if (!/^https:\/\/[^/?#]/i.test(text)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const safe =
    url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  return safe ? text : null;
}

/** What a later sign-in changes in the account. */
export interface ProfileUpdate {
  /** Only present when Google sent a usable name: an empty one never replaces the stored name. */
  fullName?: string;
  /** Google is the source of truth for the photo: no valid photo means null. */
  avatarUrl: string | null;
}

export function profileUpdateFrom(
  name: string | undefined,
  picture: string | undefined,
): ProfileUpdate {
  const fullName = cleanName(name);
  return {
    ...(fullName === undefined ? {} : { fullName }),
    avatarUrl: cleanAvatarUrl(picture),
  };
}
