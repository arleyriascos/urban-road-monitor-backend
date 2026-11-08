import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeGoogle, OTHER_CLIENT_ID, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import {
  GoogleAuthLibraryVerifier,
  GoogleUnavailableError,
  InvalidGoogleTokenError,
} from './google-token-verifier.js';

const google = new FakeGoogle();
const verifier = () => new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, google.client());
const nowS = () => Math.floor(Date.now() / 1000);

/** A verifier whose library throws what we say, to check how the errors are sorted. */
function verifierThatThrows(error: unknown) {
  return new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, {
    verifyIdToken: () => Promise.reject(error),
  } as never);
}

describe('GoogleAuthLibraryVerifier with the real library', () => {
  it('reads what a good token says', async () => {
    const issuedAt = nowS();
    const claims = await verifier().verify(google.idToken({}, issuedAt));

    expect(claims).toEqual({
      subject: '110169484474386276334',
      email: 'ana@example.com',
      emailVerified: true,
      name: 'Ana Pérez',
      picture: 'https://lh3.googleusercontent.com/a/ana=s96-c',
      issuedAt,
    });
  });

  it('accepts the other issuer Google uses and leaves out what the token does not say', async () => {
    const token = google.idToken({
      iss: 'accounts.google.com',
      name: undefined,
      picture: undefined,
    });
    const claims = await verifier().verify(token);

    expect(claims.name).toBeUndefined();
    expect(claims.picture).toBeUndefined();
    expect(claims.subject).toBe('110169484474386276334');
  });

  it('rejects a token issued for another client ID', async () => {
    const token = google.idToken({ aud: OTHER_CLIENT_ID });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects a token from another issuer', async () => {
    const token = google.idToken({ iss: 'https://accounts.evil.example' });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects an expired token', async () => {
    const token = google.idToken({}, nowS() - 7200);
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects a token signed with another key', async () => {
    const token = google.sign(
      {
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
        sub: '1',
        iat: nowS(),
        exp: nowS() + 3600,
      },
      { key: FakeGoogle.otherKey() },
    );
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects a token whose key id Google does not publish', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = google.sign(
      {
        iss: 'https://accounts.google.com',
        aud: TEST_CLIENT_ID,
        sub: '1',
        iat: nowS(),
        exp: nowS() + 3600,
      },
      { key: privateKey, keyId: 'a-key-nobody-published' },
    );
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('rejects a token whose content was changed after it was signed', async () => {
    const [header, payload, signature] = google.idToken().split('.');
    const changed = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: '42' }),
    ).toString('base64url');
    await expect(verifier().verify(`${header}.${changed}.${signature}`)).rejects.toBeInstanceOf(
      InvalidGoogleTokenError,
    );
  });

  it.each(['', 'not-a-token', 'a.b', 'a.b.c', 'a.b.c.d'])('rejects %j', async (text) => {
    await expect(verifier().verify(text)).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('says the keys are not available, and not that the token is wrong, when Google cannot be reached', async () => {
    google.keysError = new Error('connect ECONNREFUSED 142.250.0.1:443');
    try {
      const failure = await verifier()
        .verify(google.idToken())
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(GoogleUnavailableError);
      expect((failure as Error).cause).toBeInstanceOf(Error);
    } finally {
      google.keysError = null;
    }
  });
});

describe('how the errors of the library are sorted', () => {
  it('an error about the keys is "unavailable"', async () => {
    const error = new Error('Failed to retrieve verification certificates: socket hang up');
    await expect(verifierThatThrows(error).verify('t')).rejects.toBeInstanceOf(
      GoogleUnavailableError,
    );
  });

  it.each([
    new Error('Invalid token signature: abc.def.ghi'),
    new Error('Token used too late, 10 > 5'),
    new TypeError('something unexpected'),
    'a text that is not an Error',
    undefined,
  ])('any other error is "invalid": %s', async (error) => {
    await expect(verifierThatThrows(error).verify('t')).rejects.toBeInstanceOf(
      InvalidGoogleTokenError,
    );
  });

  it('never repeats the token in the error it throws', async () => {
    const token = 'header.payload.signature';
    const failure = await verifierThatThrows(new Error(`Invalid token signature: ${token}`))
      .verify(token)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidGoogleTokenError);
    expect((failure as Error).message).not.toContain(token);
    expect((failure as Error).cause).toBeUndefined();
  });

  it('says "invalid" when the library answers without a payload', async () => {
    const empty = new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, {
      verifyIdToken: () => Promise.resolve({ getPayload: () => undefined }),
    } as never);
    await expect(empty.verify('t')).rejects.toBeInstanceOf(InvalidGoogleTokenError);
  });

  it('leaves out the fields that do not have the type they should', async () => {
    const odd = new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, {
      verifyIdToken: () =>
        Promise.resolve({
          getPayload: () => ({
            sub: 12345,
            email: ['a@b.c'],
            email_verified: 'true',
            name: null,
            picture: {},
            iat: '1700000000',
          }),
        }),
    } as never);

    expect(await odd.verify('t')).toEqual({
      subject: undefined,
      email: undefined,
      emailVerified: undefined,
      name: undefined,
      picture: undefined,
      issuedAt: undefined,
    });
  });

  it('keeps email_verified when it is false', async () => {
    const claims = await verifier().verify(google.idToken({ email_verified: false }));
    expect(claims.emailVerified).toBe(false);
  });
});
