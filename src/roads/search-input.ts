import { z } from 'zod';
import { DEFAULT_SUGGESTIONS } from '../services/road-search.service.js';

export const MAX_SUGGESTIONS = 20;
export const MAX_QUERY_LENGTH = 100;

export const roadSearchInputSchema = z
  .object({
    query: z
      .object({
        q: z
          .string()
          .trim()
          .min(1, 'must not be empty')
          .max(MAX_QUERY_LENGTH, `must have at most ${MAX_QUERY_LENGTH} characters`),
        limit: z
          .string()
          .regex(/^\d{1,3}$/, 'must be a whole number, with digits only')
          .transform(Number)
          .pipe(z.number().int().min(1).max(MAX_SUGGESTIONS))
          .optional(),
      })
      .strict(),
  })
  .transform(({ query }) => ({ text: query.q, limit: query.limit ?? DEFAULT_SUGGESTIONS }));
