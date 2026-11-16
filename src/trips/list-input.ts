import { z } from 'zod';

export const DEFAULT_TRIPS_PAGE = 20;
export const MAX_TRIPS_PAGE = 50;

/** The query string of GET /api/trips: how many trips to read and where to continue from. */
export const listTripsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_TRIPS_PAGE).default(DEFAULT_TRIPS_PAGE),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;
