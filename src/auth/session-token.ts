import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes are 256 bits: nobody can guess one, so a plain SHA-256 is enough to store it. */
const TOKEN_BYTES = 32;

/** 32 bytes in base64url are always 43 characters. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new session identifier: 32 random bytes from the system's cryptographic generator,
 * written in base64url. The client receives it once, when the session opens.
 */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * What the database stores instead of the identifier: its SHA-256 in hexadecimal
 * (64 characters). Whoever reads the database cannot use it as an identifier.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether a text can be a session identifier. A text that cannot is rejected without
 * asking the database anything.
 */
export function isWellFormedSessionToken(value: string): boolean {
  return TOKEN_FORMAT.test(value);
}
