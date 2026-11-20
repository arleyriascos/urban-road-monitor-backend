import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from './session-token.js';

/** What a link sent by e-mail is for. */
export type EmailTokenPurpose = 'verify_email' | 'reset_password';

const HOUR_MS = 60 * 60 * 1000;

/** How long a link works. Choosing a new password is the riskier one, so it is the shorter. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * HOUR_MS,
  reset_password: HOUR_MS,
};

/** The token of a link: 32 random bytes in base64url, the same kind as a session identifier. */
export const generateEmailToken = generateSessionToken;

/** What the database stores instead of the token: its SHA-256 in hexadecimal. */
export const hashEmailToken = hashSessionToken;

/** Whether a text can be a token. One that cannot is refused without asking the database. */
export const isWellFormedEmailToken = isWellFormedSessionToken;
