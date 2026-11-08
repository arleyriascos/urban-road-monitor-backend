import { OAuth2Client } from 'google-auth-library';

/**
 * What a Google ID token says about a person, with each field already checked for its type.
 * A field that is missing or has an unexpected type is undefined: deciding whether the token
 * is good enough is not the job of the verifier (see google-identity.ts).
 */
export interface GoogleTokenClaims {
  /** "sub": the person's identifier at Google. It never changes, unlike the email. */
  subject?: string;
  email?: string;
  /** Only a real boolean counts; any other value is left undefined. */
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  /** "iat": when Google issued the token, in seconds since 1970. */
  issuedAt?: number;
}

/** The token is not good: bad signature, wrong audience or issuer, expired, or not a token. */
export class InvalidGoogleTokenError extends Error {
  constructor(message = 'The Google token is not valid') {
    super(message);
    this.name = 'InvalidGoogleTokenError';
  }
}

/** The token could not be checked because Google's keys could not be fetched. */
export class GoogleUnavailableError extends Error {
  constructor(message = "Google's verification keys are not available right now", cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GoogleUnavailableError';
  }
}

/**
 * Checks a Google ID token and says what it claims. The login service depends on this
 * interface, so its tests use a fake one and never need Google.
 *
 * It throws InvalidGoogleTokenError when the token is wrong and GoogleUnavailableError when
 * it could not be checked. The difference matters: "I could not check" is not "it is wrong".
 */
export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleTokenClaims>;
}

/**
 * The library puts this text in front of the error it gets when it cannot download Google's
 * public keys. Every other error of verifyIdToken is about the token itself.
 */
const KEYS_FAILURE_PREFIX = 'Failed to retrieve verification certificates';

function isKeysFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(KEYS_FAILURE_PREFIX);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function claimsOf(payload: object): GoogleTokenClaims {
  const raw = payload as Record<string, unknown>;
  const issuedAt = raw.iat;
  return {
    subject: textOf(raw.sub),
    email: textOf(raw.email),
    emailVerified: typeof raw.email_verified === 'boolean' ? raw.email_verified : undefined,
    name: textOf(raw.name),
    picture: textOf(raw.picture),
    issuedAt: typeof issuedAt === 'number' && Number.isFinite(issuedAt) ? issuedAt : undefined,
  };
}

/**
 * The verifier that uses Google's own library (google-auth-library). The library downloads
 * Google's public keys, caches them and handles their rotation, then checks the signature,
 * the issuer, the expiry and that the token was issued for OUR client ID (the audience).
 *
 * The errors it throws never carry the library's message: that message can contain the whole
 * token, and a token is a credential that must not end up in a log.
 */
export class GoogleAuthLibraryVerifier implements GoogleTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly client: Pick<OAuth2Client, 'verifyIdToken'> = new OAuth2Client(),
  ) {}

  async verify(idToken: string): Promise<GoogleTokenClaims> {
    let payload: object | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      payload = ticket.getPayload();
    } catch (error) {
      if (isKeysFailure(error)) {
        throw new GoogleUnavailableError(undefined, error);
      }
      throw new InvalidGoogleTokenError();
    }
    if (!payload) {
      throw new InvalidGoogleTokenError('The Google token has no content');
    }
    return claimsOf(payload);
  }
}
