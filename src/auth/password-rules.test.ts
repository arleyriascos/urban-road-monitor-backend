import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  passwordProblemMessage,
} from './password-rules.js';

const EMAIL = 'ana@example.com';

describe('passwordProblem', () => {
  it('accepts a password with no composition rules, from 10 to 128 characters', () => {
    expect(passwordProblem('a'.repeat(9) + 'b', EMAIL)).toBeNull();
    expect(passwordProblem('solo minusculas y espacios', EMAIL)).toBeNull();
    expect(passwordProblem('x1'.repeat(PASSWORD_MAX_LENGTH / 2), EMAIL)).toBeNull();
  });

  it('rejects what is too short or too long', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH - 1), EMAIL)).toBe('too_short');
    expect(passwordProblem('', EMAIL)).toBe('too_short');
    expect(passwordProblem('xy'.repeat(PASSWORD_MAX_LENGTH), EMAIL)).toBe('too_long');
  });

  it('rejects the email, however it is written', () => {
    expect(passwordProblem('ana@example.com', EMAIL)).toBe('same_as_email');
    expect(passwordProblem('ANA@Example.com', EMAIL)).toBe('same_as_email');
    expect(passwordProblem('ana@example.com', ' Ana@Example.com ')).toBe('same_as_email');
  });

  it('rejects common passwords and one repeated character', () => {
    expect(passwordProblem('Password123', EMAIL)).toBe('too_common');
    expect(passwordProblem('1234567890', EMAIL)).toBe('too_common');
    expect(passwordProblem('qwerty uiop', EMAIL)).toBe('too_common');
    expect(passwordProblem('aaaaaaaaaaaa', EMAIL)).toBe('too_common');
  });

  it('has a message for every problem', () => {
    for (const problem of ['too_short', 'too_long', 'same_as_email', 'too_common'] as const) {
      expect(passwordProblemMessage(problem).length).toBeGreaterThan(10);
    }
  });
});
