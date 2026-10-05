import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

/**
 * Last middleware in the chain: turns every error into a JSON response
 * with the correct HTTP status code. Express 5 sends errors from async
 * handlers here automatically.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Expected errors thrown by services (e.g. database unavailable).
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  // Malformed JSON body sent by the client.
  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON' },
    });
    return;
  }

  // Anything else is a bug: log it and hide the details in production.
  console.error('Unexpected error:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'Something went wrong on the server'
          : String(error instanceof Error ? error.message : error),
    },
  });
}
