import { profileUpdateFrom, nameForNewAccount } from '../auth/profile-rules.js';
import { prisma } from '../config/database.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { isUniqueViolation } from './prisma-errors.js';

/** The role every new account starts with: more than a guest, with no permission to write. */
export const BASE_ROLE = 'usuario';

const GOOGLE = 'google';

/** The person as the frontend sees them after signing in. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  /** The names of their roles, in alphabetical order. */
  roles: string[];
}

/** What a verified Google token gives the repository. `now` comes from the caller's clock. */
export interface GoogleSignIn {
  subject: string;
  /** Already in lowercase: the users table refuses anything else. */
  email: string;
  name: string | undefined;
  picture: string | undefined;
  now: Date;
}

export type GoogleSignInOutcome =
  | {
      kind: 'signed_in';
      user: AuthUser;
      /** The account did not exist and was created now. */
      created: boolean;
      /** The account existed (same verified email) and the Google identity was linked now. */
      linked: boolean;
    }
  /** The person is known but the account is deactivated or deleted. Nothing was changed. */
  | { kind: 'inactive'; userId: string }
  /** That email already belongs to an account linked to another Google identity. */
  | { kind: 'email_conflict' };

const ACCOUNT_FIELDS = {
  id: true,
  email: true,
  full_name: true,
  avatar_url: true,
  is_active: true,
  deleted_at: true,
  email_verified_at: true,
} as const;

interface AccountRow {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  is_active: boolean;
  deleted_at: Date | null;
  email_verified_at: Date | null;
}

/** The role in the migration is missing: the database is not at the version the code expects. */
export class MissingBaseRoleError extends Error {
  constructor() {
    super(`The role "${BASE_ROLE}" does not exist: apply migration 08 to this database`);
    this.name = 'MissingBaseRoleError';
  }
}

/** One try, and one more if two sign-ins of the same new person collided on a unique key. */
const MAX_ATTEMPTS = 2;

function isActive(account: AccountRow): boolean {
  return account.is_active && account.deleted_at === null;
}

/**
 * The accounts of the people who sign in with Google.
 *
 * The whole decision of a sign-in runs in ONE transaction, so there is never a half-made
 * account (a user without a role, or without its Google link):
 *
 * 1. The Google identity ("sub") is already linked: that is the person. Signing in again.
 * 2. It is not, and no account has that email: a new account is created, with its Google
 *    link and the base role.
 * 3. It is not, and an account has that email: the identity is linked to it, because Google
 *    has verified the email. Unless that account is already linked to ANOTHER Google
 *    identity: then nothing is linked, because the address may have passed to someone else.
 *    If that account was made with a password and its email was never verified, it becomes
 *    the Google account: the password is deleted and its sessions are closed.
 *
 * A deactivated or deleted account is never signed in and never linked: it comes back as
 * "inactive" with nothing changed. When it does sign in, the name and photo come from Google
 * (the email and the roles never change here) and last_login_at is set.
 */
export class UserRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async signInWithGoogle(input: GoogleSignIn): Promise<GoogleSignInOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.$transaction((tx) => this.resolve(tx, input));
      } catch (error) {
        // Two sign-ins of the same new person at once: the second one fails on a unique key
        // (the email or the Google link). Trying again finds what the first one made.
        if (attempt < MAX_ATTEMPTS && isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
  }

  private async resolve(
    tx: Prisma.TransactionClient,
    input: GoogleSignIn,
  ): Promise<GoogleSignInOutcome> {
    const link = await tx.oauth_accounts.findUnique({
      where: {
        provider_provider_account_id: { provider: GOOGLE, provider_account_id: input.subject },
      },
      select: { users: { select: ACCOUNT_FIELDS } },
    });
    if (link) {
      return this.enter(tx, link.users, input, { created: false, linked: false });
    }

    const sameEmail = await tx.users.findUnique({
      where: { email: input.email },
      select: {
        ...ACCOUNT_FIELDS,
        password_credentials: { select: { user_id: true } },
        oauth_accounts: {
          where: { provider: GOOGLE },
          take: 1,
          select: { provider_account_id: true },
        },
      },
    });
    if (sameEmail) {
      if (!isActive(sameEmail)) {
        return { kind: 'inactive', userId: sameEmail.id };
      }
      const [linked] = sameEmail.oauth_accounts;
      if (linked) {
        // The same Google identity: another sign-in of this person finished between the two
        // lookups above, so this IS the person, signing in again. A DIFFERENT identity linked
        // to this email is the real conflict: the address may have passed to someone else.
        return linked.provider_account_id === input.subject
          ? this.enter(tx, sameEmail, input, { created: false, linked: false })
          : { kind: 'email_conflict' };
      }
      await tx.oauth_accounts.create({
        data: { user_id: sameEmail.id, provider: GOOGLE, provider_account_id: input.subject },
      });
      if (sameEmail.password_credentials && !sameEmail.email_verified_at) {
        // A password account whose email nobody verified: whoever made it may not own that
        // address, and Google just proved the person in front of us does. The account becomes
        // Google's: the password is deleted and the sessions opened with it are closed.
        await tx.password_credentials.delete({ where: { user_id: sameEmail.id } });
        await tx.sessions.updateMany({
          where: { user_id: sameEmail.id, revoked_at: null },
          data: { revoked_at: input.now },
        });
      }
      return this.enter(tx, sameEmail, input, { created: false, linked: true });
    }

    return this.createAccount(tx, input);
  }

  /** Signs an existing, active account in: name, photo and last_login_at. */
  private async enter(
    tx: Prisma.TransactionClient,
    account: AccountRow,
    input: GoogleSignIn,
    how: { created: boolean; linked: boolean },
  ): Promise<GoogleSignInOutcome> {
    if (!isActive(account)) {
      return { kind: 'inactive', userId: account.id };
    }
    const update = profileUpdateFrom(input.name, input.picture);
    const updated = await tx.users.update({
      where: { id: account.id },
      data: {
        last_login_at: input.now,
        avatar_url: update.avatarUrl,
        // Google verifies the email at every sign-in.
        ...(account.email_verified_at ? {} : { email_verified_at: input.now }),
        ...(update.fullName === undefined ? {} : { full_name: update.fullName }),
      },
      select: ACCOUNT_FIELDS,
    });
    return { kind: 'signed_in', user: await this.withRoles(tx, updated), ...how };
  }

  private async createAccount(
    tx: Prisma.TransactionClient,
    input: GoogleSignIn,
  ): Promise<GoogleSignInOutcome> {
    const role = await tx.roles.findUnique({ where: { name: BASE_ROLE }, select: { id: true } });
    if (!role) {
      throw new MissingBaseRoleError();
    }
    const created = await tx.users.create({
      data: {
        email: input.email,
        full_name: nameForNewAccount(input.name, input.email),
        avatar_url: profileUpdateFrom(input.name, input.picture).avatarUrl,
        last_login_at: input.now,
        email_verified_at: input.now,
        oauth_accounts: { create: { provider: GOOGLE, provider_account_id: input.subject } },
        user_roles: { create: { role_id: role.id } },
      },
      select: ACCOUNT_FIELDS,
    });
    return {
      kind: 'signed_in',
      user: await this.withRoles(tx, created),
      created: true,
      linked: false,
    };
  }

  private async withRoles(tx: Prisma.TransactionClient, account: AccountRow): Promise<AuthUser> {
    const rows = await tx.user_roles.findMany({
      where: { user_id: account.id },
      select: { roles: { select: { name: true } } },
    });
    return {
      id: account.id,
      email: account.email,
      fullName: account.full_name,
      avatarUrl: account.avatar_url,
      roles: rows.map((row) => row.roles.name).sort(),
    };
  }
}

export const userRepository = new UserRepository();
