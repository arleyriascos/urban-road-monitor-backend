import { createApp } from './app.js';
import { disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { consolidationCoordinator } from './services/consolidation-coordinator.js';
import { consolidationService } from './services/consolidation.service.js';
import { emailLinkService } from './services/email-link.service.js';
import { googleLoginService } from './services/google-login.service.js';
import { routeService } from './services/route.service.js';

/** How long a consolidation that is going on may delay the shutdown. */
const SHUTDOWN_WAIT_MS = 8_000;

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  if (!routeService.isConfigured) {
    console.warn(
      'POST /api/routes answers 503: set AI_SERVICE_URL and INTERNAL_TOKEN to enable routes',
    );
  }
  if (consolidationService.isConfigured) {
    // Detections that arrived while the server was off (a deploy, a crash) are grouped too.
    void consolidationCoordinator.start();
  } else {
    console.warn(
      'Detections are not grouped into potholes: set AI_SERVICE_URL and INTERNAL_TOKEN to enable it',
    );
  }
  if (!emailLinkService.isConfigured) {
    console.warn(
      'The e-mail links answer 503: set BREVO_API_KEY, MAIL_FROM and APP_URL to enable them',
    );
  }
  if (!googleLoginService.isConfigured) {
    console.warn(
      'POST /api/auth/google answers 503: set GOOGLE_CLIENT_ID to enable Google sign-in',
    );
  }
});

// Close the HTTP server and the database pool cleanly when the process stops
// (Render sends SIGTERM on every deploy or restart).
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close();
  // No new run is planned; one that is going on gets a few seconds to finish (Render stops the
  // server soon after SIGTERM, and a run cut short is simply tried again).
  await Promise.race([
    consolidationCoordinator.stop(),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS)),
  ]);
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
