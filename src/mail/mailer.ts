/** One e-mail to one person. The text and the html say the same; a client shows one of them. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What the rest of the code needs from an e-mail service: send one message or throw MailError. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** The message could not be sent. It never carries the API key, the address or the answer's text. */
export class MailError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface BrevoOptions {
  /** The API key of the account. It travels only in the "api-key" header, to Brevo. */
  apiKey: string;
  /** A sender verified in Brevo. */
  fromEmail: string;
  fromName: string;
  /** Replaceable in tests; the real one is the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Sends e-mail through the transactional API of Brevo over HTTPS. HTTP and not SMTP because the
 * free plan of Render blocks the SMTP ports. It waits at most a few seconds for the answer, and
 * when something fails it says only the status Brevo gave: the body of an answer can repeat the
 * address of the person.
 */
export class BrevoMailer implements Mailer {
  private readonly send_: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: BrevoOptions) {
    this.send_ = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.send_(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.options.fromName, email: this.options.fromEmail },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new MailError(timedOut ? 'Brevo did not answer in time' : 'Brevo could not be reached');
    }
    if (!response.ok) {
      throw new MailError(`Brevo refused the message (HTTP ${response.status})`, response.status);
    }
  }
}
