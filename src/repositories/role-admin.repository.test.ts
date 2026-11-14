import { describe, expect, it } from 'vitest';
import { ROLE_NAMES } from '../auth/role-command.js';
import { roleChangeReason } from './role-admin.repository.js';

/** The short lowercase code that auth_logs.reason accepts (see auth-log.repository.ts). */
const REASON_FORMAT = /^[a-z][a-z_]{0,39}$/;

describe('roleChangeReason', () => {
  it('says what was done and to which role', () => {
    expect(roleChangeReason('add', 'colaborador')).toBe('added_colaborador');
    expect(roleChangeReason('remove', 'administrador')).toBe('removed_administrador');
  });

  it('is a valid reason for auth_logs for every action and every role', () => {
    for (const role of ROLE_NAMES) {
      for (const action of ['add', 'remove'] as const) {
        expect(roleChangeReason(action, role)).toMatch(REASON_FORMAT);
      }
    }
  });
});
