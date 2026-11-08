import type { GoogleTokenClaims } from './google-token-verifier.js';

/**
 * Whether what a verified Google token says is enough to sign somebody in. The library has
 * already checked the signature, the issuer, the audience and the expiry; this adds what is
 * ours: the person must be identifiable, their email must be verified, and the token must be
 * fresh. It is a pure function of the claims and of the time, so it is tested without Google.
 */

/**
 * A token is issued the moment the person chooses their account, so in a normal sign-in it
 * is a few seconds old. Google gives it an hour of life; accepting it for only 10 minutes
 * shortens the time a stolen token could be used.
 */
export const GOOGLE_TOKEN_MAX_AGE_S = 10 * 60;

/** How far ahead of our clock the token's "iat" may be, for clocks that differ a little. */
export const GOOGLE_TOKEN_CLOCK_SKEW_S = 60;

/** The size of oauth_accounts.provider_account_id and of users.email. */
const SUBJECT_MAX_LENGTH = 255;
const EMAIL_MAX_LENGTH = 255;

/** The same shape the users table demands (chk_users_email_format). */
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Printable ASCII only. The database keeps emails in lowercase and checks it with its own
 * lower(), which does not always agree with JavaScript for other alphabets; with ASCII there
 * is no disagreement, so no email can fail that check halfway through a sign-in.
 */
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

/** Why a sign-in was refused, as the short code that goes to auth_logs (never to the client). */
export type GoogleIdentityRejection = 'invalid_token' | 'email_unverified' | 'token_too_old';

/** The person a good token identifies. */
export interface GoogleIdentity {
  subject: string;
  /** In lowercase and trimmed: this is what the users table stores. */
  email: string;
  name: string | undefined;
  picture: string | undefined;
}

export type GoogleIdentityCheck =
  { ok: true; identity: GoogleIdentity } | { ok: false; reason: GoogleIdentityRejection };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUsableSubject(subject: string | undefined): subject is string {
  return (
    subject !== undefined &&
    subject !== '' &&
    subject.length <= SUBJECT_MAX_LENGTH &&
    PRINTABLE_ASCII.test(subject)
  );
}

function isUsableEmail(email: string): boolean {
  return (
    email.length <= EMAIL_MAX_LENGTH && PRINTABLE_ASCII.test(email) && EMAIL_FORMAT.test(email)
  );
}

/**
 * The order of the checks is part of the behaviour: first the token must say who it is
 * (invalid_token), then the email must be verified (email_unverified), and last the token
 * must be fresh (token_too_old). A token without "iat" counts as too old: nothing says when
 * it was issued.
 */
export function checkGoogleIdentity(claims: GoogleTokenClaims, now: Date): GoogleIdentityCheck {
  if (!isUsableSubject(claims.subject) || claims.email === undefined) {
    return { ok: false, reason: 'invalid_token' };
  }
  const email = normalizeEmail(claims.email);
  if (!isUsableEmail(email)) {
    return { ok: false, reason: 'invalid_token' };
  }

  if (claims.emailVerified !== true) {
    return { ok: false, reason: 'email_unverified' };
  }

  if (claims.issuedAt === undefined) {
    return { ok: false, reason: 'token_too_old' };
  }
  const ageS = Math.floor(now.getTime() / 1000) - claims.issuedAt;
  if (ageS > GOOGLE_TOKEN_MAX_AGE_S) {
    return { ok: false, reason: 'token_too_old' };
  }
  if (ageS < -GOOGLE_TOKEN_CLOCK_SKEW_S) {
    // Issued in the future, further than a small clock difference explains.
    return { ok: false, reason: 'invalid_token' };
  }

  return {
    ok: true,
    identity: { subject: claims.subject, email, name: claims.name, picture: claims.picture },
  };
}
