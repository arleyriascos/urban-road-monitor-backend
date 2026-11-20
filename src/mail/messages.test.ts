import { describe, expect, it } from 'vitest';
import { resetMessage, verificationMessage } from './messages.js';

const link = 'https://site.example.com/verificar#token=abc_DEF-123';

describe('the e-mail messages', () => {
  it('addresses the person and carries the link in the text and in the html', () => {
    for (const make of [verificationMessage, resetMessage]) {
      const message = make({ to: 'ana@example.com', link });
      expect(message.to).toBe('ana@example.com');
      expect(message.text).toContain(link);
      expect(message.html).toContain(`href="${link}"`);
    }
  });

  it('says in Spanish and in English how long the link lasts', () => {
    const verify = verificationMessage({ to: 'a@example.com', link });
    expect(verify.text).toContain('dura 24 horas');
    expect(verify.text).toContain('lasts 24 hours');
    const reset = resetMessage({ to: 'a@example.com', link });
    expect(reset.text).toContain('dura 1 hora');
    expect(reset.text).toContain('lasts 1 hour');
  });

  it('puts the link safely inside the html attribute', () => {
    const message = verificationMessage({
      to: 'a@example.com',
      link: 'https://x.example/#a="b"&c',
    });
    expect(message.html).toContain('href="https://x.example/#a=&quot;b&quot;&amp;c"');
    expect(message.html).not.toContain('a="b"');
  });

  it('has a subject in both languages and never asks for a password', () => {
    expect(verificationMessage({ to: 'a@example.com', link }).subject).toBe(
      'Verifica tu correo · Verify your email',
    );
    const reset = resetMessage({ to: 'a@example.com', link });
    expect(reset.subject).toBe('Elige una contraseña nueva · Choose a new password');
    expect(reset.text.toLowerCase()).not.toContain('envíanos tu contraseña');
  });
});
