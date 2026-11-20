import type { MailMessage } from './mailer.js';

/** What a message needs apart from who gets it: the link, and how long it works. */
interface LinkMessage {
  to: string;
  link: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function build(
  to: string,
  subject: string,
  link: string,
  es: { intro: string; button: string; expires: string; ignore: string },
  en: { intro: string; button: string; expires: string; ignore: string },
): MailMessage {
  const text = [
    es.intro,
    link,
    es.expires,
    es.ignore,
    '',
    '---',
    '',
    en.intro,
    link,
    en.expires,
    en.ignore,
  ].join('\n');
  const safe = escapeHtml(link);
  const part = (c: typeof es) =>
    `<p>${c.intro}</p><p><a href="${safe}">${c.button}</a></p>` +
    `<p style="color:#555">${c.expires} ${c.ignore}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px">${part(es)}<hr>${part(en)}</div>`;
  return { to, subject, text, html };
}

/** The e-mail with the link that proves the address is the person's. */
export function verificationMessage({ to, link }: LinkMessage): MailMessage {
  return build(
    to,
    'Verifica tu correo · Verify your email',
    link,
    {
      intro: 'Para verificar tu correo en Urban Road Monitor, abre este enlace:',
      button: 'Verificar mi correo',
      expires: 'El enlace funciona una vez y dura 24 horas.',
      ignore: 'Si no creaste una cuenta, ignora este mensaje.',
    },
    {
      intro: 'To verify your email in Urban Road Monitor, open this link:',
      button: 'Verify my email',
      expires: 'The link works once and lasts 24 hours.',
      ignore: 'If you did not create an account, ignore this message.',
    },
  );
}

/** The e-mail with the link to choose a new password. */
export function resetMessage({ to, link }: LinkMessage): MailMessage {
  return build(
    to,
    'Elige una contraseña nueva · Choose a new password',
    link,
    {
      intro:
        'Pediste cambiar tu contraseña de Urban Road Monitor. Abre este enlace para elegir una nueva:',
      button: 'Elegir una contraseña nueva',
      expires: 'El enlace funciona una vez y dura 1 hora.',
      ignore: 'Si no fuiste tú, ignora este mensaje: tu contraseña no cambia.',
    },
    {
      intro:
        'You asked to change your Urban Road Monitor password. Open this link to choose a new one:',
      button: 'Choose a new password',
      expires: 'The link works once and lasts 1 hour.',
      ignore: 'If it was not you, ignore this message: your password does not change.',
    },
  );
}
