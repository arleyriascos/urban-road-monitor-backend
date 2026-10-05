import { createApp } from './app.js';
import { disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Close the HTTP server and the database pool cleanly when the process stops
// (Render sends SIGTERM on every deploy or restart).
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
