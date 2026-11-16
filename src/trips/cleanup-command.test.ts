import { describe, expect, it } from 'vitest';
import { CleanupCommandError, parseCleanupCommand } from './cleanup-command.js';

describe('parseCleanupCommand', () => {
  it('only looks, with every trip of the account, when only the email is given', () => {
    expect(parseCleanupCommand(['Ana@Example.com'])).toEqual({
      email: 'ana@example.com',
      since: null,
      apply: false,
    });
  });

  it('counts the day from 00:00 in Colombia', () => {
    const command = parseCleanupCommand(['ana@example.com', '--desde', '2026-11-16']);

    expect(command.since?.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });

  it('deletes only when asked with --aplicar, wherever the option is', () => {
    expect(parseCleanupCommand(['--aplicar', 'ana@example.com']).apply).toBe(true);
    expect(
      parseCleanupCommand(['ana@example.com', '--desde', '2026-11-16', '--aplicar']).apply,
    ).toBe(true);
  });

  it.each([
    [[], 'Falta el correo'],
    [['ana'], 'no parece un correo'],
    [['a@b@c.com'], 'no parece un correo'],
    [['ana@example.com', 'luis@example.com'], 'una cuenta a la vez'],
    [['ana@example.com', '--desde'], 'Falta la fecha'],
    [['ana@example.com', '--desde', '--aplicar'], 'Falta la fecha'],
    [['ana@example.com', '--desde', '16/11/2026'], 'no es una fecha'],
    [['ana@example.com', '--desde', '2026-02-31'], 'no es un día que exista'],
    [['ana@example.com', '--desde', '2026-11-16', '--desde', '2026-11-17'], 'dos veces'],
    [['ana@example.com', '--todo'], 'no existe'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCleanupCommand(args)).toThrow(CleanupCommandError);
    expect(() => parseCleanupCommand(args)).toThrow(message);
  });
});
