import { describe, expect, it } from 'vitest';
import { googleLoginSchema } from '../controllers/auth.controller.js';
import { LOGIN_ATTEMPTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { authPaths, authSchemas, authTags } from './auth-openapi.js';
import { openApiDocument } from './openapi.js';

const post = authPaths['/api/auth/google'].post;

describe('auth documentation', () => {
  it('describes one endpoint, a POST, under the Auth tag', () => {
    expect(Object.keys(authPaths)).toEqual(['/api/auth/google']);
    expect(Object.keys(authPaths['/api/auth/google'])).toEqual(['post']);
    expect(post.tags).toEqual(['Auth']);
    expect(authTags.map((tag) => tag.name)).toEqual(['Auth']);
  });

  it('documents every answer the endpoint gives', () => {
    expect(Object.keys(post.responses).sort()).toEqual(['200', '400', '401', '403', '429', '503']);
  });

  it('names the error codes of each answer', () => {
    const description = (status: '400' | '401' | '403' | '429' | '503') =>
      post.responses[Number(status) as 400 | 401 | 403 | 429 | 503].description;

    expect(description('400')).toContain('INVALID_REQUEST');
    expect(description('401')).toContain('INVALID_GOOGLE_TOKEN');
    expect(description('403')).toContain('ACCOUNT_DISABLED');
    expect(description('429')).toContain('TOO_MANY_REQUESTS');
    for (const code of [
      'AUTH_PROVIDER_UNAVAILABLE',
      'AUTH_NOT_CONFIGURED',
      'DATABASE_UNAVAILABLE',
    ]) {
      expect(description('503')).toContain(code);
    }
  });

  it('states the same limit the limiter applies', () => {
    expect(authTags[0]?.description).toContain(`${LOGIN_ATTEMPTS_PER_MINUTE} attempts per minute`);
    expect(post.responses[429].description).toContain(`${LOGIN_ATTEMPTS_PER_MINUTE} attempts`);
  });

  it('declares the credential limits that the real validation uses', () => {
    const { minLength, maxLength } = authSchemas.GoogleLoginRequest.properties.credential;
    expect(googleLoginSchema.safeParse({ credential: 'x'.repeat(minLength) }).success).toBe(true);
    expect(googleLoginSchema.safeParse({ credential: 'x'.repeat(minLength - 1) }).success).toBe(
      false,
    );
    expect(googleLoginSchema.safeParse({ credential: 'x'.repeat(maxLength) }).success).toBe(true);
    expect(googleLoginSchema.safeParse({ credential: 'x'.repeat(maxLength + 1) }).success).toBe(
      false,
    );
  });

  it('describes a session identifier of the exact shape the backend creates', () => {
    const { pattern } = authSchemas.GoogleLoginAnswer.properties.token;
    const identifier = 'A'.repeat(43);
    expect(new RegExp(pattern).test(identifier)).toBe(true);
    expect(new RegExp(pattern).test('A'.repeat(42))).toBe(false);
    expect(new RegExp(pattern).test('A'.repeat(44))).toBe(false);
    expect(new RegExp(pattern).test(`${'A'.repeat(42)}=`)).toBe(false);
  });

  it('lists in the answer the five fields of the person', () => {
    expect(authSchemas.AuthUser.required).toEqual([
      'id',
      'email',
      'fullName',
      'avatarUrl',
      'roles',
    ]);
    expect(authSchemas.GoogleLoginAnswer.required).toEqual(['token', 'expiresAt', 'user']);
  });

  it('is part of the main document, with its schemas', () => {
    expect(openApiDocument.paths['/api/auth/google']).toBe(authPaths['/api/auth/google']);
    const schemas = Object.keys(openApiDocument.components.schemas);
    expect(schemas).toEqual(
      expect.arrayContaining(['GoogleLoginRequest', 'GoogleLoginAnswer', 'AuthUser']),
    );
  });
});
