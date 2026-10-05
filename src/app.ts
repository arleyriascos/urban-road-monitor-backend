import express from 'express';
import { corsMiddleware } from './middlewares/cors.js';
import { errorHandler } from './middlewares/error-handler.js';
import { notFoundHandler } from './middlewares/not-found.js';
import { apiRouter } from './routes/index.js';

/**
 * Creates and configures the Express application.
 * Keeping the app separate from server.ts makes it easier to test.
 */
export function createApp() {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'Urban Road Monitor API',
      description: 'Pothole detection and route recommendation on urban roads',
      status: 'active',
      endpoints: ['/api/health', '/api/hello'],
    });
  });

  app.use('/api', apiRouter);

  // Must be registered after all routes.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
