import { describe, expect, it, vi } from 'vitest';
import { createMailSetup } from './mail-setup.js';

const full = {
  BREVO_API_KEY: 'k'.repeat(30),
  MAIL_FROM: 'sender@example.com',
  MAIL_FROM_NAME: 'Urban Road Monitor',
  APP_URL: 'https://site.example.com',
};

describe('createMailSetup', () => {
  it('is null unless the key, the sender and the app address are all there', () => {
    expect(createMailSetup({ MAIL_FROM_NAME: 'x' })).toBeNull();
    expect(createMailSetup({ ...full, BREVO_API_KEY: undefined })).toBeNull();
    expect(createMailSetup({ ...full, MAIL_FROM: undefined })).toBeNull();
    expect(createMailSetup({ ...full, APP_URL: undefined })).toBeNull();
  });

  it('gives a mailer and the address of the links when everything is set', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{}', { status: 201 })),
    );
    const setup = createMailSetup(full, fetchMock);

    expect(setup?.appUrl).toBe('https://site.example.com');
    await setup?.mailer.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
