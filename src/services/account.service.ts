import { AppError } from '../errors/app-error.js';
import {
  accountRepository,
  type AccountProfile,
  type AccountRepository,
} from '../repositories/account.repository.js';

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
}

/**
 * What a signed-in person is and what they may do.
 *
 * If the database does not answer, it throws a 503 and never a "no": "I could not check" is
 * not "you may not". The frontend keeps the session on a 503 and tries again.
 */
export class AccountService {
  constructor(
    private readonly accounts: Pick<
      AccountRepository,
      'findProfile' | 'hasPermission'
    > = accountRepository,
  ) {}

  /** The person with their roles and permissions, or null if the account is no longer active. */
  async profile(userId: string): Promise<AccountProfile | null> {
    try {
      return await this.accounts.findProfile(userId);
    } catch (error) {
      console.error('Could not read the profile of an account:', error);
      throw databaseUnavailable();
    }
  }

  /** Whether the person has a role that grants the permission code. */
  async hasPermission(userId: string, code: string): Promise<boolean> {
    try {
      return await this.accounts.hasPermission(userId, code);
    } catch (error) {
      console.error('Could not check a permission:', error);
      throw databaseUnavailable();
    }
  }
}

export const accountService = new AccountService();
