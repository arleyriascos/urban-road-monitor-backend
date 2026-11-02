import { z } from 'zod';

/**
 * Validates environment variables once at startup.
 * If something is missing or invalid, the server stops with a clear message
 * instead of failing later with an obscure error.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .min(1, 'DATABASE_URL is required')
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'DATABASE_URL must be a PostgreSQL connection string',
      }),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // Shared secret for the /internal endpoints, used by the AI service. Optional: without it
    // those endpoints answer 404, so deploying before setting it in Render is safe.
    // An empty value (INTERNAL_TOKEN= in .env) counts as not set.
    INTERNAL_TOKEN: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().min(32, 'INTERNAL_TOKEN must have at least 32 characters').optional(),
    ),
    // Address of the AI service that computes routes. Optional: without it (or without
    // INTERNAL_TOKEN) POST /api/routes answers 503 and the rest of the API keeps working.
    AI_SERVICE_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .trim()
        .transform((value) => value.replace(/\/+$/, ''))
        .refine(isServiceUrl, {
          message:
            'AI_SERVICE_URL must be an http:// or https:// address without a user, query or fragment',
        })
        .optional(),
    ),
    // How many routes the route cache keeps (an LRU cache: the least recently used goes first).
    ROUTE_CACHE_CAPACITY: z.coerce.number().int().min(1).max(10_000).default(200),
  })
  .superRefine((value, context) => {
    // The call to the AI service carries INTERNAL_TOKEN, so it must never travel in clear text.
    if (value.NODE_ENV === 'production' && value.AI_SERVICE_URL?.startsWith('http://')) {
      context.addIssue({
        code: 'custom',
        path: ['AI_SERVICE_URL'],
        message: 'AI_SERVICE_URL must use https:// in production',
      });
    }
  });

function isServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname !== '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
