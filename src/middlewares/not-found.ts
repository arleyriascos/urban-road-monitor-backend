import type { Request, Response } from 'express';

/** Any route that did not match returns a JSON 404 instead of an HTML page. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist`,
    },
  });
}
