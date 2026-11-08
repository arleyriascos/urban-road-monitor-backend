import { LOGIN_ATTEMPTS_PER_MINUTE } from '../middlewares/rate-limit.js';

/**
 * OpenAPI description of POST /api/auth/google, the sign-in with Google. It is spread into the
 * main document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const authTags = [
  {
    name: 'Auth',
    description:
      'Sign-in with Google. The frontend sends the ID token that the Google button gives it and ' +
      'receives a session identifier, which it sends in every protected request as ' +
      '"Authorization: Bearer <identifier>". ' +
      `At most ${LOGIN_ATTEMPTS_PER_MINUTE} attempts per minute and IP address.`,
  },
];

export const authSchemas = {
  GoogleLoginRequest: {
    type: 'object',
    properties: {
      credential: {
        type: 'string',
        minLength: 1,
        maxLength: 4096,
        description:
          'The ID token (a JWT) that Google gives the frontend. Other fields that the Google ' +
          'button hands over (select_by, clientId...) are ignored.',
        example:
          'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyIsInR5cCI6IkpXVCJ9.eyJpc3MiOi4uLn0.c2lnbmF0dXJl',
      },
    },
    required: ['credential'],
  },
  AuthUser: {
    type: 'object',
    description: 'The signed-in person.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', example: 'ana@example.com' },
      fullName: { type: 'string', example: 'Ana Pérez' },
      avatarUrl: {
        type: ['string', 'null'],
        description: 'An https address, or null when Google sent no usable photo',
        example: 'https://lh3.googleusercontent.com/a/ACg8oc=s96-c',
      },
      roles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The names of their roles, in alphabetical order. A new account has "usuario".',
        example: ['usuario'],
      },
    },
    required: ['id', 'email', 'fullName', 'avatarUrl', 'roles'],
  },
  GoogleLoginAnswer: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        pattern: '^[A-Za-z0-9_-]{43}$',
        description:
          'The session identifier: 43 characters. It is shown only in this answer, and only its ' +
          'hash is stored, so it cannot be recovered. Send it as "Authorization: Bearer <token>".',
      },
      expiresAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When the session expires if it is not used: seven days, renewed by use, and never ' +
          'more than thirty days after it was opened.',
      },
      user: { $ref: '#/components/schemas/AuthUser' },
    },
    required: ['token', 'expiresAt', 'user'],
  },
};

export const authPaths = {
  '/api/auth/google': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in with the ID token of Google',
      description:
        'Checks the token (signature, that it was issued for this app, that it has not expired), ' +
        'that its email is verified and that it was issued less than 10 minutes ago. Then it ' +
        'finds the person by their Google identity. If there is none, an account with the same ' +
        'email gets the identity linked, and if there is no such account either, a new one is ' +
        'made with the role "usuario". The name and photo come from Google at every sign-in; ' +
        'the email of an existing account never changes. Every problem with the token answers ' +
        'the same 401, whatever the reason, and the reason is kept only in the audit log.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/GoogleLoginRequest' } },
        },
      },
      responses: {
        200: {
          description:
            'The session and the person. The answer is sent with "Cache-Control: no-store".',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GoogleLoginAnswer' } },
          },
        },
        400: errorResponse('INVALID_REQUEST or INVALID_JSON: the body is not valid'),
        401: errorResponse(
          'INVALID_GOOGLE_TOKEN: the token could not be verified (bad signature, another app, ' +
            'expired, too old, unverified email, or an email that belongs to another Google ' +
            'identity). The message is always the same.',
        ),
        403: errorResponse(
          'ACCOUNT_DISABLED: Google confirmed the person, but the account is disabled',
        ),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${LOGIN_ATTEMPTS_PER_MINUTE} attempts in a minute; see Retry-After`,
        ),
        503: errorResponse(
          'AUTH_PROVIDER_UNAVAILABLE (Google could not be reached to check the token: try again), ' +
            'AUTH_NOT_CONFIGURED (the server has no GOOGLE_CLIENT_ID) or DATABASE_UNAVAILABLE',
        ),
      },
    },
  },
};
