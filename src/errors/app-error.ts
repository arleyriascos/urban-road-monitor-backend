/**
 * Expected application error with its HTTP status code.
 * Services throw it; the error-handling middleware turns it into a JSON response.
 * `details` carries extra data for the client, such as which clicked point was too far.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
