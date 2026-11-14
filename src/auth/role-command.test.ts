import { describe, expect, it } from 'vitest';
import {
  BASE_ROLE_NAME,
  ROLE_COMMAND_HELP,
  ROLE_NAMES,
  RoleCommandError,
  parseRoleCommand,
} from './role-command.js';

function messageOf(args: string[]): string {
  try {
    parseRoleCommand(args);
  } catch (error) {
    expect(error).toBeInstanceOf(RoleCommandError);
    return (error as Error).message;
  }
  throw new Error('the command was accepted');
}

describe('parseRoleCommand', () => {
  it('reads an add and a remove', () => {
    expect(parseRoleCommand(['add', 'ana@example.com', 'colaborador'])).toEqual({
      action: 'add',
      email: 'ana@example.com',
      role: 'colaborador',
    });
    expect(parseRoleCommand(['remove', 'ana@example.com', 'administrador'])).toEqual({
      action: 'remove',
      email: 'ana@example.com',
      role: 'administrador',
    });
  });

  it('accepts all three roles to add', () => {
    for (const role of ROLE_NAMES) {
      expect(parseRoleCommand(['add', 'ana@example.com', role]).role).toBe(role);
    }
  });

  it('writes the email in lowercase and without spaces around it, as the users table keeps it', () => {
    expect(parseRoleCommand(['add', '  Ana.Perez@Example.COM ', 'colaborador']).email).toBe(
      'ana.perez@example.com',
    );
  });

  it('accepts the action and the role in any case', () => {
    expect(parseRoleCommand(['ADD', 'ana@example.com', 'Colaborador'])).toMatchObject({
      action: 'add',
      role: 'colaborador',
    });
  });

  it.each([
    [[], 0],
    [['add'], 1],
    [['add', 'ana@example.com'], 2],
    [['add', 'ana@example.com', 'colaborador', 'extra'], 4],
  ])('refuses %j: it needs exactly three words', (args, count) => {
    const message = messageOf(args);
    expect(message).toContain(`llegaron ${count}`);
    expect(message).toContain('Uso: npm run user:role');
  });

  it('refuses an unknown action and says which ones exist', () => {
    expect(messageOf(['grant', 'ana@example.com', 'colaborador'])).toContain('add o remove');
  });

  it('refuses an unknown role and lists the real ones', () => {
    const message = messageOf(['add', 'ana@example.com', 'jefe']);
    expect(message).toContain('"jefe"');
    for (const role of ROLE_NAMES) {
      expect(message).toContain(role);
    }
  });

  it.each([
    'ana',
    'ana@',
    '@example.com',
    'ana@@example.com',
    'a@b@c.com',
    'ana perez@x.com',
    'ana@exámple.com',
  ])('refuses "%s" as an email', (email) => {
    expect(messageOf(['add', email, 'colaborador'])).toContain('no parece un correo');
  });

  it('never takes the base role away, from anybody', () => {
    const message = messageOf(['remove', 'ana@example.com', BASE_ROLE_NAME]);
    expect(message).toContain('no se quita');
    expect(message).toContain('desactiva su cuenta');
  });

  it('still lets the base role be added', () => {
    expect(parseRoleCommand(['add', 'ana@example.com', BASE_ROLE_NAME]).role).toBe('usuario');
  });
});

describe('the roles of the command', () => {
  it('are the three that the database has, the base one first', () => {
    expect(ROLE_NAMES).toEqual(['usuario', 'colaborador', 'administrador']);
    expect(BASE_ROLE_NAME).toBe('usuario');
  });

  it('are all named in the help, with the rules that protect the system', () => {
    for (const role of ROLE_NAMES) {
      expect(ROLE_COMMAND_HELP).toContain(role);
    }
    expect(ROLE_COMMAND_HELP).toContain('SI');
    expect(ROLE_COMMAND_HELP).toContain('último administrador');
    expect(ROLE_COMMAND_HELP).toContain('role_changed');
  });
});
