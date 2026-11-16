/** What the person asked npm run trips:cleanup to do, already checked and tidied. */
export interface CleanupCommand {
  /** The account whose trips are looked at, in lowercase as the users table keeps it. */
  email: string;
  /** Only the trips that started at this moment or later; null for every trip of the account. */
  since: Date | null;
  /** False (the default) only shows what would go; true deletes, after asking. */
  apply: boolean;
}

/** A mistake in the command: its message is written for the person at the keyboard. */
export class CleanupCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleanupCommandError';
  }
}

export const CLEANUP_COMMAND_HELP = `Borra los viajes de prueba de una cuenta, con sus detecciones.

Uso: npm run trips:cleanup -- <correo> [--desde AAAA-MM-DD] [--aplicar]

Ejemplos:
  npm run trips:cleanup -- ana@example.com
  npm run trips:cleanup -- ana@example.com --desde 2026-11-16
  npm run trips:cleanup -- ana@example.com --desde 2026-11-16 --aplicar

Reglas:
  - Sin --aplicar solo muestra qué se borraría: no cambia nada.
  - --desde cuenta el día desde las 00:00 de Colombia (UTC-5). Sin él entran todos los viajes de la cuenta.
  - Con --aplicar muestra a qué base de datos apunta y pide escribir SI antes de borrar.
  - No borra un viaje si alguna de sus detecciones ya forma parte de un bache: esos datos ya
    cuentan para el mapa.
  - No borra la cuenta ni sus dispositivos, solo los viajes y sus detecciones.`;

/** One @, something on each side, and only visible ASCII characters (no spaces). */
const EMAIL_SHAPE = /^[\x21-\x7e]+@[\x21-\x7e]+$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The date as the start of that day in Colombia, or an error if it is not a real date. */
function parseSince(text: string): Date {
  const match = DATE_SHAPE.exec(text.trim());
  if (!match) {
    throw new CleanupCommandError(`"${text}" no es una fecha: usa AAAA-MM-DD (2026-11-16).`);
  }
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00-05:00`);
  // 2026-02-31 would silently become March: compare what came out with what went in.
  const same = new Date(date.getTime() - 5 * 3_600_000).toISOString().slice(0, 10) === text.trim();
  if (Number.isNaN(date.getTime()) || !same) {
    throw new CleanupCommandError(`"${text}" no es un día que exista.`);
  }
  return date;
}

export function parseCleanupCommand(args: readonly string[]): CleanupCommand {
  let email: string | null = null;
  let since: Date | null = null;
  let apply = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--aplicar') {
      apply = true;
    } else if (arg === '--desde') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CleanupCommandError('Falta la fecha después de --desde.');
      }
      if (since !== null) {
        throw new CleanupCommandError('--desde se escribió dos veces.');
      }
      since = parseSince(value);
      i += 1;
    } else if (arg.startsWith('--')) {
      throw new CleanupCommandError(`La opción "${arg}" no existe.`);
    } else {
      if (email !== null) {
        throw new CleanupCommandError('Solo se puede limpiar una cuenta a la vez.');
      }
      const candidate = arg.trim().toLowerCase();
      if (!EMAIL_SHAPE.test(candidate) || candidate.split('@').length !== 2) {
        throw new CleanupCommandError(
          `"${arg}" no parece un correo (por ejemplo ana@example.com).`,
        );
      }
      email = candidate;
    }
  }

  if (email === null) {
    throw new CleanupCommandError('Falta el correo de la cuenta.');
  }
  return { email, since, apply };
}
