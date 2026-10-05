import cors from 'cors';
import { env } from '../config/env.js';

/**
 * Only the frontend origins listed in CORS_ORIGIN can call the API from a browser.
 * Requests without an Origin header (curl, Render health checks) are allowed.
 */
export const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGIN.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
