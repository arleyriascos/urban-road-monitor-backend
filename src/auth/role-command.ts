/** The roles of the system, as migration 08 and the seed data create them. */
export const ROLE_NAMES = ['usuario', 'colaborador', 'administrador'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** The role every account has: it is the base, so it is never taken away. */
export const BASE_ROLE_NAME: RoleName = 'usuario';

export type RoleAction = 'add' | 'remove';

/** What the person asked npm run user:role to do, already checked and tidied. */
export interface RoleCommand {
  action: RoleAction;
  /** In lowercase, as the users table keeps it. */
  email: string;
  role: RoleName;
}

/** A mistake in the command: its message is written for the person at the keyboard. */
export class RoleCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleCommandError';
  }
}

export const ROLE_COMMAND_HELP = `Agrega o quita un rol a una cuenta que ya ingresó con Google.

Uso: npm run user:role -- <add|remove> <correo> <rol>

Roles: ${ROLE_NAMES.join(', ')}

Ejemplos:
  npm run user:role -- add ana@example.com colaborador
  npm run user:role -- remove ana@example.com colaborador

Reglas:
  - Muestra a qué base de datos apunta y pide escribir SI antes de cambiar nada.
  - La cuenta ya debe existir: la persona tiene que ingresar una vez con Google.
  - El rol usuario no se quita: es la base de toda cuenta.
  - No se puede quitar el último administrador activo.
  - Cada cambio queda anotado como role_changed en auth_logs.`;

/** One @, something on each side, and only visible ASCII characters (no spaces). */
const EMAIL_SHAPE = /^[\x21-\x7e]+@[\x21-\x7e]+$/;

function parseAction(text: string): RoleAction {
  const action = text.trim().toLowerCase();
  if (action === 'add' || action === 'remove') {
    return action;
  }
  throw new RoleCommandError(`La acción "${text}" no existe: usa add o remove.`);
}

function parseEmail(text: string): string {
  const email = text.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email) || email.split('@').length !== 2) {
    throw new RoleCommandError(`"${text}" no parece un correo (por ejemplo ana@example.com).`);
  }
  return email;
}

function parseRole(text: string): RoleName {
  const role = text.trim().toLowerCase();
  const known = ROLE_NAMES.find((name) => name === role);
  if (!known) {
    throw new RoleCommandError(
      `El rol "${text}" no existe. Los roles son: ${ROLE_NAMES.join(', ')}.`,
    );
  }
  return known;
}

/**
 * Reads the three words that come after "npm run user:role --": the action, the email and the
 * role. It throws a RoleCommandError, with an explanation, for anything it should not do:
 * a missing or extra word, an unknown action or role, something that is not an email, or
 * taking the base role away.
 */
export function parseRoleCommand(args: readonly string[]): RoleCommand {
  if (args.length !== 3) {
    throw new RoleCommandError(
      `Faltan o sobran datos: se esperan 3 (acción, correo y rol) y llegaron ${args.length}.\n` +
        'Uso: npm run user:role -- <add|remove> <correo> <rol>',
    );
  }
  const [actionText, emailText, roleText] = args as [string, string, string];
  const action = parseAction(actionText);
  const email = parseEmail(emailText);
  const role = parseRole(roleText);

  if (action === 'remove' && role === BASE_ROLE_NAME) {
    throw new RoleCommandError(
      `El rol ${BASE_ROLE_NAME} no se quita: es la base de toda cuenta. ` +
        'Para impedir que alguien ingrese, desactiva su cuenta.',
    );
  }
  return { action, email, role };
}
