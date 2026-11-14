import { describe, expect, it } from 'vitest';
import type { RoleChangePreview } from '../services/role-change.service.js';
import { formatRoleChangePreview, isConfirmation } from './role-change-report.js';

const preview: RoleChangePreview = {
  target: { host: 'db.example.com', database: 'urban_road_monitor' },
  command: { action: 'add', email: 'ana@example.com', role: 'colaborador' },
  account: {
    userId: 'u1',
    email: 'ana@example.com',
    fullName: 'Ana Pérez',
    isActive: true,
    roles: ['usuario'],
  },
  rolesBefore: ['usuario'],
  rolesAfter: ['colaborador', 'usuario'],
};

describe('isConfirmation', () => {
  it.each(['si', 'SI', ' Si ', 'sí', 'SÍ'])('accepts %j', (answer) => {
    expect(isConfirmation(answer)).toBe(true);
  });

  it.each(['', ' ', 'no', 'sip', 's', 'yes', 'si, claro', 'ok'])('cancels on %j', (answer) => {
    expect(isConfirmation(answer)).toBe(false);
  });
});

describe('formatRoleChangePreview', () => {
  it('names the database, the account and the roles before and after', () => {
    const text = formatRoleChangePreview(preview);
    expect(text).toContain('DARLE el rol colaborador');
    expect(text).toContain('db.example.com');
    expect(text).toContain('urban_road_monitor');
    expect(text).toContain('Ana Pérez <ana@example.com>');
    expect(text).toContain('Roles hoy:      usuario');
    expect(text).toContain('Roles después:  colaborador, usuario');
  });

  it('says QUITARLE when the role is taken away', () => {
    const text = formatRoleChangePreview({
      ...preview,
      command: { action: 'remove', email: 'ana@example.com', role: 'colaborador' },
      rolesBefore: ['colaborador', 'usuario'],
      rolesAfter: ['usuario'],
    });
    expect(text).toContain('QUITARLE el rol colaborador');
    expect(text).toContain('Roles después:  usuario');
  });

  it('shows "(ninguno)" for an empty list', () => {
    expect(formatRoleChangePreview({ ...preview, rolesBefore: [] })).toContain(
      'Roles hoy:      (ninguno)',
    );
  });
});
