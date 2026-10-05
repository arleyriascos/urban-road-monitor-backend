/**
 * Expected application error with its HTTP status code.
 * Services throw it; the error-handling middleware turns it into a JSON response.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
