import express from 'express';

/**
 * Creates and configures the Express application.
 * Keeping the app separate from server.ts makes it easier to test.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'Urban Road Monitor API',
      description: 'Pothole detection and route recommendation on urban roads',
      status: 'active',
    });
  });

  return app;
}
