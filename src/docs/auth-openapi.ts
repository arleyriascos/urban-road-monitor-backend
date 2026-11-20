import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password-rules.js';
import {
  LOGIN_ATTEMPTS_PER_MINUTE,
  PASSWORD_CHANGES_PER_MINUTE,
  PASSWORD_LOGIN_ATTEMPTS_PER_EMAIL,
  PASSWORD_LOGIN_ATTEMPTS_PER_MINUTE,
  REGISTER_ATTEMPTS_PER_10_MINUTES,
} from '../middlewares/rate-limit.js';

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
      'Sign-in with Google or with an email and a password, who I am, changing the password, ' +
      'and sign-out. The frontend sends the ID token that the Google button gives it, or the ' +
      'email and password of the person, and receives a session identifier, which it sends in ' +
      'every protected request as "Authorization: Bearer <identifier>". ' +
      `Google: at most ${LOGIN_ATTEMPTS_PER_MINUTE} attempts per minute and IP address. ` +
      `Password: at most ${PASSWORD_LOGIN_ATTEMPTS_PER_MINUTE} per minute and IP address and ` +
      `${PASSWORD_LOGIN_ATTEMPTS_PER_EMAIL} per 15 minutes and email; ` +
      `${REGISTER_ATTEMPTS_PER_10_MINUTES} sign-ups per 10 minutes and IP address.`,
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
      hasPassword: {
        type: 'boolean',
        description:
          'The account has a password of its own (it may also use Google). Only then can ' +
          'POST /api/auth/password change it.',
      },
      emailVerified: {
        type: 'boolean',
        description:
          'The person proved that the email is theirs. Google does it at every sign-in; an ' +
          'account made with a password starts as false.',
      },
    },
    required: ['permissions', 'hasPassword', 'emailVerified'],
  },
  MeAnswer: {
    type: 'object',
    properties: { user: { $ref: '#/components/schemas/AccountProfile' } },
    required: ['user'],
  },
  RegisterRequest: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 150, example: 'Ana Pérez' },
      email: { type: 'string', format: 'email', maxLength: 255, example: 'ana@example.com' },
      password: {
        type: 'string',
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
        description:
          `From ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, with no rule ` +
          'about letters or symbols. It cannot be the email nor a very common password.',
      },
    },
    required: ['name', 'email', 'password'],
  },
  PasswordLoginRequest: {
    type: 'object',
    properties: {
      email: { type: 'string', maxLength: 255, example: 'ana@example.com' },
      password: { type: 'string', minLength: 1 },
    },
    required: ['email', 'password'],
  },
  ChangePasswordRequest: {
    type: 'object',
    properties: {
      currentPassword: { type: 'string', minLength: 1 },
      newPassword: {
        type: 'string',
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
        description:
          'The same rules as the password of the sign-up, and different from the current one.',
      },
    },
    required: ['currentPassword', 'newPassword'],
  },
  ChangePasswordAnswer: {
    type: 'object',
    properties: {
      otherSessionsClosed: {
        type: 'integer',
        minimum: 0,
        description: 'How many other sessions of the person were closed. The current one stays.',
      },
    },
    required: ['otherSessionsClosed'],
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

const sessionAnswer = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/GoogleLoginAnswer' } } },
});

export const authPaths = {
  '/api/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Sign up with an email and a password',
      description:
        'Makes an account with the role "usuario", whose email is NOT verified yet, and opens ' +
        'a session for it. Only a hash of the password is stored (scrypt). An account that ' +
        'later signs in with Google using the same email becomes the Google account (see ' +
        'POST /api/auth/google).',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } },
        },
      },
      responses: {
        201: sessionAnswer('The session and the person. Sent with "Cache-Control: no-store".'),
        400: errorResponse(
          'INVALID_REQUEST (the body is not valid) or INVALID_PASSWORD (the password breaks a ' +
            'rule: details.problem is too_short, too_long, same_as_email or too_common)',
        ),
        409: errorResponse('EMAIL_TAKEN: an account with that email already exists'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${REGISTER_ATTEMPTS_PER_10_MINUTES} sign-ups in 10 minutes; see Retry-After`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE'),
      },
    },
  },
  '/api/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in with an email and a password',
      description:
        'Opens a session. Every failure answers the same 401, whether the email has no account, ' +
        'the password is wrong or the account is disabled, and takes the same time: the answer ' +
        'never says which. The reason is kept only in the audit log.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/PasswordLoginRequest' } },
        },
      },
      responses: {
        200: sessionAnswer('The session and the person. Sent with "Cache-Control: no-store".'),
        400: errorResponse('INVALID_REQUEST: the body is not valid'),
        401: errorResponse('INVALID_CREDENTIALS: the email or the password is not correct'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${PASSWORD_LOGIN_ATTEMPTS_PER_MINUTE} attempts per minute from the address, or ` +
            `${PASSWORD_LOGIN_ATTEMPTS_PER_EMAIL} per 15 minutes for that email; see Retry-After`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE'),
      },
    },
  },
  '/api/auth/password': {
    post: {
      tags: ['Auth'],
      summary: 'Change the password of the current session’s account',
      description:
        'Needs the current password. All the OTHER sessions of the person are closed; the one ' +
        'that makes the request stays open. A wrong current password answers 403 and not 401, ' +
        'because a 401 makes the frontend drop a session that is perfectly good. An account ' +
        'that only signs in with Google has no password to change.',
      security: [{ sessionToken: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordRequest' } },
        },
      },
      responses: {
        200: {
          description: 'The password was changed. Sent with "Cache-Control: no-store".',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordAnswer' } },
          },
        },
        400: errorResponse(
          'INVALID_REQUEST or INVALID_PASSWORD (the new password breaks a rule or equals the ' +
            'current one: details.problem)',
        ),
        401: errorResponse('UNAUTHORIZED: there is no valid session'),
        403: errorResponse('INVALID_CURRENT_PASSWORD: the current password is not correct'),
        409: errorResponse(
          'NO_PASSWORD_SET: the account has no password (it signs in with Google)',
        ),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${PASSWORD_CHANGES_PER_MINUTE} attempts in a minute; see Retry-After`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE'),
      },
    },
  },
  '/api/auth/google': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in with the ID token of Google',
      description:
        'Checks the token (signature, that it was issued for this app, that it has not expired), ' +
        'that its email is verified and that it was issued less than 10 minutes ago. Then it ' +
        'finds the person by their Google identity. If there is none, an account with the same ' +
        'email gets the identity linked, and if there is no such account either, a new one is ' +
        'made with the role "usuario". An account made with a password whose email was never ' +
        'verified becomes the Google account: its password is deleted and its sessions are ' +
        'closed. The name and photo come from Google at every sign-in; ' +
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
