import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

/**
 * A stand-in for Google in the tests: it signs ID tokens with a key made on the spot and gives
 * the real google-auth-library an OAuth2Client that reads that key instead of Google's. So the
 * tests run the real verification (signature, issuer, audience, expiry) without the network.
 */
// Made up, and built in pieces so that GitHub's secret scanning does not mistake it for a real one.
const APPS_SUFFIX = ['.apps', 'googleusercontent', 'com'].join('.');
export const TEST_CLIENT_ID = `123456789-testclientid${APPS_SUFFIX}`;
/** The ID of another app, to make tokens that were issued for somebody else. */
export const OTHER_CLIENT_ID = `999999999-other${APPS_SUFFIX}`;

const KEY_ID = 'test-key-1';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export class FakeGoogle {
  private readonly privateKey: KeyObject;
  private readonly publicKeyPem: string;
  /** How many times the library asked for the keys. */
  keyRequests = 0;
  /** While it is set, asking for the keys fails with this error, as if Google was down. */
  keysError: Error | null = null;

  constructor() {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /** An OAuth2Client that gets Google's keys from this object and never from the network. */
  client(): OAuth2Client {
    const client = new OAuth2Client();
    const transporter = client.transporter as unknown as { request: () => Promise<unknown> };
    transporter.request = async () => {
      this.keyRequests += 1;
      if (this.keysError) {
        throw this.keysError;
      }
      return { data: { [KEY_ID]: this.publicKeyPem }, headers: new Headers() };
    };
    return client;
  }

  /** A token signed with the key Google would use. `claims` is written as the payload. */
  sign(claims: Record<string, unknown>, options: { key?: KeyObject; keyId?: string } = {}): string {
    const header = { alg: 'RS256', typ: 'JWT', kid: options.keyId ?? KEY_ID };
    const signed = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256')
      .update(signed)
      .sign(options.key ?? this.privateKey);
    return `${signed}.${base64url(signature)}`;
  }

  /** A token as Google issues it to Ana, at `nowS` seconds; `overrides` changes or removes fields. */
  idToken(
    overrides: Record<string, unknown> = {},
    nowS: number = Math.floor(Date.now() / 1000),
  ): string {
    const claims: Record<string, unknown> = {
      iss: 'https://accounts.google.com',
      aud: TEST_CLIENT_ID,
      sub: '110169484474386276334',
      email: 'ana@example.com',
      email_verified: true,
      name: 'Ana Pérez',
      picture: 'https://lh3.googleusercontent.com/a/ana=s96-c',
      iat: nowS,
      exp: nowS + 3600,
      ...overrides,
    };
    for (const [name, value] of Object.entries(claims)) {
      if (value === undefined) {
        delete claims[name];
      }
    }
    return this.sign(claims);
  }

  /** A key that is not the one Google uses, to make tokens with a signature that must fail. */
  static otherKey(): KeyObject {
    return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
}
