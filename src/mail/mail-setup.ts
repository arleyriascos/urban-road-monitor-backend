import { BrevoMailer, type Mailer } from './mailer.js';

/** The settings the e-mail service reads (from the environment variables). */
export interface MailSettings {
  BREVO_API_KEY?: string | undefined;
  MAIL_FROM?: string | undefined;
  MAIL_FROM_NAME: string;
  /** Where the links of the messages lead: the address of the frontend, with no path. */
  APP_URL?: string | undefined;
}

export interface MailSetup {
  mailer: Mailer;
  appUrl: string;
}

/**
 * The e-mail service, or null when it is not configured. It needs the three things together:
 * the API key, a sender and the address of the page the links go to. Without them the routes
 * that send e-mail answer 503 and the rest of the API works as before.
 */
export function createMailSetup(
  settings: MailSettings,
  fetchImpl?: typeof fetch,
): MailSetup | null {
  const { BREVO_API_KEY, MAIL_FROM, MAIL_FROM_NAME, APP_URL } = settings;
  if (!BREVO_API_KEY || !MAIL_FROM || !APP_URL) {
    return null;
  }
  return {
    appUrl: APP_URL,
    mailer: new BrevoMailer({
      apiKey: BREVO_API_KEY,
      fromEmail: MAIL_FROM,
      fromName: MAIL_FROM_NAME,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  };
}
