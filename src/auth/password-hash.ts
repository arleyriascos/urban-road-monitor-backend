import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Hashes and checks passwords with scrypt, which ships with Node: no dependency to add.
 *
 * What is stored is one self-describing text, "scrypt$N$r$p$salt$hash" (salt and hash in
 * base64url). The cost parameters travel with the hash, so they can be raised later and the
 * old hashes keep working.
 */
const COST = 16384; // N: 16 MiB of memory per hash with r = 8
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** Never accept a stored hash that asks for more than this: a poisoned row must not exhaust memory. */
const MAX_COST = 1 << 17;

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, options, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

/** The hash of a password, ready to store. A new random salt makes every call different. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

interface ParsedHash {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const cost = Number(n);
  const blockSize = Number(r);
  const parallelism = Number(p);
  const valid =
    Number.isInteger(cost) &&
    cost >= 2 &&
    cost <= MAX_COST &&
    (cost & (cost - 1)) === 0 &&
    Number.isInteger(blockSize) &&
    blockSize >= 1 &&
    blockSize <= 16 &&
    Number.isInteger(parallelism) &&
    parallelism >= 1 &&
    parallelism <= 4;
  if (!valid || !salt || !key) {
    return null;
  }
  return {
    cost,
    blockSize,
    parallelism,
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
  };
}

/** Whether the password matches the stored hash. A malformed hash is simply "no". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length === 0) {
    return false;
  }
  const key = await derive(password, parsed.salt, parsed.key.length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelism,
    maxmem: 256 * parsed.cost * parsed.blockSize,
  });
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the time of a real check when there is no account to check against, so a login for
 * an email that does not exist takes as long as one with a wrong password.
 */
export async function verifyAgainstNothing(password: string): Promise<false> {
  dummyHash ??= hashPassword('no-account-has-this-password');
  await verifyPassword(password, await dummyHash);
  return false;
}
