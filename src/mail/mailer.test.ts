import { describe, expect, it, vi } from 'vitest';
import { BREVO_SEND_URL, BrevoMailer, MailError, type MailMessage } from './mailer.js';

const message: MailMessage = {
  to: 'ana@example.com',
  subject: 'Hola',
  text: 'texto',
  html: '<p>texto</p>',
};
const apiKey = 'k'.repeat(30);

function mailer(answer: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(() => answer());
  const brevo = new BrevoMailer({
    apiKey,
    fromEmail: 'sender@example.com',
    fromName: 'Urban Road Monitor',
    fetch: fetchMock,
    timeoutMs: 50,
  });
  return { brevo, fetchMock };
}

describe('BrevoMailer', () => {
  it('posts the message to Brevo with the key in a header and the sender and the person in the body', async () => {
    const { brevo, fetchMock } = mailer(() =>
      Promise.resolve(new Response('{"messageId":"x"}', { status: 201 })),
    );

    await brevo.send(message);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(BREVO_SEND_URL);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['api-key']).toBe(apiKey);
    expect(JSON.parse(String(init?.body))).toEqual({
      sender: { name: 'Urban Road Monitor', email: 'sender@example.com' },
      to: [{ email: 'ana@example.com' }],
      subject: 'Hola',
      textContent: 'texto',
      htmlContent: '<p>texto</p>',
    });
    expect(String(init?.body)).not.toContain(apiKey);
  });

  it('says only the status when Brevo refuses, never what the answer says', async () => {
    const { brevo } = mailer(() =>
      Promise.resolve(new Response('{"message":"ana@example.com is not valid"}', { status: 400 })),
    );

    const error = await brevo.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).status).toBe(400);
    expect((error as MailError).message).toBe('Brevo refused the message (HTTP 400)');
    expect((error as MailError).message).not.toContain('ana@example.com');
  });

  it('says it could not reach Brevo when the network fails, without the key', async () => {
    const { brevo } = mailer(() => Promise.reject(new TypeError(`fetch failed ${apiKey}`)));

    const error = await brevo.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).message).toBe('Brevo could not be reached');
  });

  it('gives up when Brevo does not answer in time', async () => {
    const { brevo } = mailer(
      () =>
        new Promise<Response>((_resolve, reject) => {
          setTimeout(() => reject(Object.assign(new Error('t'), { name: 'TimeoutError' })), 10);
        }),
    );

    await expect(brevo.send(message)).rejects.toThrow('Brevo did not answer in time');
  });
});
