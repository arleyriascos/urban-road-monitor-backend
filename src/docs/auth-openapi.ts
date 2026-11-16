import { LOGIN_ATTEMPTS_PER_MINUTE } from '../middlewares/rate-limit.js';

/**
 * OpenAPI description of the sign-in with Google (POST /api/auth/google), of asking who the
 * session belongs to (GET /api/auth/me) and of signing out (POST /api/auth/logout). It is
 * spread into the main document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const authTags = [
  {
    name: 'Auth',
    description:
      'Sign-in with Google, who I am, and sign-out. The frontend sends the ID token that the ' +
      'Google button gives it and receives a session identifier, which it sends in every ' +
      'protected request as "Authorization: Bearer <identifier>". ' +
      `Signing in: at most ${LOGIN_ATTEMPTS_PER_MINUTE} attempts per minute and IP address.`,
  },
];

export const authSecuritySchemes = {
  sessionToken: {
    type: 'http',
    scheme: 'bearer',
    description:
      'The session identifier that POST /api/auth/google gives. Without a valid session ' +
      'every request that needs one gets the same 401, whatever the reason.',
  },
};

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
  AccountProfile: {
    type: 'object',
    description:
      'The signed-in person like the sign-in answers it, plus what their roles let them do.',
    allOf: [{ $ref: '#/components/schemas/AuthUser' }],
    properties: {
      permissions: {
        type: 'array',
        items: { type: 'string', example: 'detections.create' },
        description:
          'The codes of the permissions that their roles give, in alphabetical order. ' +
          'A person with only "usuario" has detections.create and trips.view_own. They are read at every request, so a role ' +
          'that was just given or taken away shows here at once.',
        example: ['detections.create', 'routes.view_history'],
      },
    },
    required: ['permissions'],
  },
  MeAnswer: {
    type: 'object',
    properties: { user: { $ref: '#/components/schemas/AccountProfile' } },
    required: ['user'],
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
  '/api/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Who the current session belongs to',
      description:
        'Gives the person of the session in the request, with their roles and the permissions ' +
        'those roles give. The frontend calls it when the page opens with a saved identifier, ' +
        'to know whether the session still lives. It is sent with "Cache-Control: no-store".',
      security: [{ sessionToken: [] }],
      responses: {
        200: {
          description: 'The person, with their roles and permissions.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MeAnswer' } } },
        },
        401: errorResponse(
          'UNAUTHORIZED: no session, or one that does not exist, has expired, was closed, or ' +
            'belongs to a deactivated account. The message is always the same.',
        ),
        503: errorResponse(
          'DATABASE_UNAVAILABLE: the session could not be checked. It is never a 401: the ' +
            'frontend must keep the session and try again.',
        ),
      },
    },
  },
  '/api/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Sign out: close the current session',
      description:
        'Closes the session that makes the request, and only that one: the same person on ' +
        'another device stays signed in. The sign-out is noted in the audit log as "logout". ' +
        'The request has no body.',
      security: [{ sessionToken: [] }],
      responses: {
        204: { description: 'The session was closed. There is no body.' },
        401: errorResponse(
          'UNAUTHORIZED: there was no valid session, so there was nothing to close (for ' +
            'example, it was already closed).',
        ),
        503: errorResponse('DATABASE_UNAVAILABLE: the session could not be checked or closed'),
      },
    },
  },
};
