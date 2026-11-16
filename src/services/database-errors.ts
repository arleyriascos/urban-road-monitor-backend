import { AppError } from '../errors/app-error.js';

/**
 * Runs a database task and turns any failure that is not an AppError into a 503. "I could not
 * read the database" must never look like "no", so the phone keeps what it has (its queue of
 * detections) and tries again later. The real error goes to the log, where bugs stay visible.
 */
export async function orUnavailable<T>(context: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error(`${context}:`, error);
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
  }
}
