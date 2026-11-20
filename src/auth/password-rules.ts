/**
 * What a password must be. The rules are few on purpose: length is what makes a password
 * hard to guess, and forcing symbols and capitals only makes people write "Password1!".
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_email' | 'too_common';

/** Passwords everybody tries first. Compared in lowercase, without spaces. */
const COMMON_PASSWORDS = new Set([
  '0123456789',
  '1111111111',
  '1234567890',
  '12345678910',
  '123456789a',
  '1q2w3e4r5t',
  'abcdefghij',
  'abcd123456',
  'admin12345',
  'asdfghjkl1',
  'asdfghjklq',
  'bienvenido',
  'bienvenida',
  'changeme123',
  'contrasena',
  'contrasena1',
  'contrasena123',
  'iloveyou123',
  'letmein123',
  'mipassword',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'qwerty1234',
  'qwerty12345',
  'qwertyuiop',
  'qwertyuiop1',
  'welcome123',
  'zxcvbnm123',
]);

/** The first thing wrong with the password, or null if it is acceptable. */
export function passwordProblem(password: string, email: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'too_short';
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return 'too_long';
  }
  const simple = password.toLowerCase().replace(/\s+/g, '');
  if (simple === email.trim().toLowerCase().replace(/\s+/g, '')) {
    return 'same_as_email';
  }
  if (COMMON_PASSWORDS.has(simple) || /^(.)\1+$/.test(simple)) {
    return 'too_common';
  }
  return null;
}

/** A message for the person, one per problem. */
export function passwordProblemMessage(problem: PasswordProblem): string {
  switch (problem) {
    case 'too_short':
      return `The password must have at least ${PASSWORD_MIN_LENGTH} characters`;
    case 'too_long':
      return `The password must have at most ${PASSWORD_MAX_LENGTH} characters`;
    case 'same_as_email':
      return 'The password cannot be your email';
    case 'too_common':
      return 'That password is too common: choose another one';
  }
}
