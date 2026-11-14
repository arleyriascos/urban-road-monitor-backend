import { describe, expect, it, vi } from 'vitest';
import { UserRepository, type GoogleSignIn, type GoogleSignInOutcome } from './user.repository.js';

const input: GoogleSignIn = {
  subject: '110169484474386276334',
  email: 'ana@example.com',
  name: 'Ana Pérez',
  picture: undefined,
  now: new Date('2026-11-10T12:00:00.000Z'),
};

const outcome: GoogleSignInOutcome = { kind: 'email_conflict' };
const collision = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

/** A database whose transactions fail or work as the test says, one answer per attempt. */
function databaseThatAnswers(answers: Array<'collision' | 'broken' | 'ok'>) {
  const transaction = vi.fn(() => {
    const answer = answers.shift() ?? 'ok';
    if (answer === 'collision') {
      return Promise.reject(collision());
    }
    if (answer === 'broken') {
      return Promise.reject(new Error('connection lost'));
    }
    return Promise.resolve(outcome);
  });
  return { repository: new UserRepository({ $transaction: transaction } as never), transaction };
}

describe('UserRepository.signInWithGoogle, when two sign-ins collide', () => {
  it('runs once when nothing goes wrong', async () => {
    const { repository, transaction } = databaseThatAnswers(['ok']);
    expect(await repository.signInWithGoogle(input)).toBe(outcome);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('tries again once when a unique key collided, and returns the second answer', async () => {
    const { repository, transaction } = databaseThatAnswers(['collision', 'ok']);
    expect(await repository.signInWithGoogle(input)).toBe(outcome);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second collision', async () => {
    const { repository, transaction } = databaseThatAnswers(['collision', 'collision', 'ok']);
    await expect(repository.signInWithGoogle(input)).rejects.toMatchObject({ code: 'P2002' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not try again for any other error', async () => {
    const { repository, transaction } = databaseThatAnswers(['broken', 'ok']);
    await expect(repository.signInWithGoogle(input)).rejects.toThrow('connection lost');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('UserRepository.signInWithGoogle, when the same person signs in twice at once', () => {
  const row = {
    id: 'user-1',
    email: 'ana@example.com',
    full_name: 'Ana Pérez',
    avatar_url: null,
    is_active: true,
    deleted_at: null,
  };

  /**
   * The moment of the race, made on purpose: the lookup by Google identity found nothing (the
   * other sign-in had not finished), and the lookup by email, a moment later, finds the account
   * that the other sign-in just made, already linked to `linkedSubject`.
   */
  function databaseWhereAnotherSignInJustFinished(linkedSubject: string) {
    const tx = {
      oauth_accounts: { findUnique: vi.fn(() => Promise.resolve(null)), create: vi.fn() },
      users: {
        findUnique: vi.fn(() =>
          Promise.resolve({ ...row, oauth_accounts: [{ provider_account_id: linkedSubject }] }),
        ),
        update: vi.fn(() => Promise.resolve(row)),
      },
      user_roles: {
        findMany: vi.fn(() => Promise.resolve([{ roles: { name: 'usuario' } }])),
      },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };
    return { repository: new UserRepository(db as never), tx };
  }

  it('signs the person in, because that account is theirs', async () => {
    const { repository, tx } = databaseWhereAnotherSignInJustFinished(input.subject);
    expect(await repository.signInWithGoogle(input)).toMatchObject({
      kind: 'signed_in',
      created: false,
      linked: false,
      user: { id: 'user-1', roles: ['usuario'] },
    });
    expect(tx.oauth_accounts.create).not.toHaveBeenCalled();
    expect(tx.users.update).toHaveBeenCalledTimes(1);
  });

  it('still refuses when the account is linked to ANOTHER Google identity', async () => {
    const { repository, tx } = databaseWhereAnotherSignInJustFinished('another-google-identity');
    expect(await repository.signInWithGoogle(input)).toEqual({ kind: 'email_conflict' });
    expect(tx.users.update).not.toHaveBeenCalled();
  });
});
