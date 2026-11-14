import type { RoleChangePreview } from '../services/role-change.service.js';

/** Only a clear "SI" confirms: anything else, an empty answer included, cancels. */
export function isConfirmation(answer: string): boolean {
  return ['si', 'sí'].includes(answer.trim().toLowerCase());
}

const roleList = (roles: readonly string[]): string =>
  roles.length > 0 ? roles.join(', ') : '(ninguno)';

/** What the person reads before confirming: WHICH database, WHICH account and what changes. */
export function formatRoleChangePreview(preview: RoleChangePreview): string {
  const { target, command, account, rolesBefore, rolesAfter } = preview;
  const verb = command.action === 'add' ? 'DARLE' : 'QUITARLE';
  return [
    `Vas a ${verb} el rol ${command.role} a esta cuenta:`,
    `  Servidor: ${target.host}`,
    `  Base:     ${target.database}`,
    `  Cuenta:   ${account.fullName} <${account.email}>`,
    `  Roles hoy:      ${roleList(rolesBefore)}`,
    `  Roles después:  ${roleList(rolesAfter)}`,
    'Cambiar roles cambia lo que esta persona puede hacer. Revisa que la base sea la correcta.',
  ].join('\n');
}
