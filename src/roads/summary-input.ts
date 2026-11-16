import { z } from 'zod';

/** How many segments before and after a segment the "window" takes, if the caller does not say. */
export const DEFAULT_WINDOW_RADIUS = 2;
export const MAX_WINDOW_RADIUS = 20;

/** A whole number written with digits only, as an id comes in the address. */
const idParam = z
  .string()
  .regex(/^[1-9]\d{0,14}$/, 'must be a positive whole number')
  .transform(Number);

/** Query numbers come as text: "2" is accepted, "2.5", "-1", "1e3" and "" are not. */
const queryInt = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, 'must be a whole number, with digits only')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const segmentSummaryInputSchema = z
  .object({
    params: z.object({ id: idParam }).strict(),
    query: z.object({ radius: queryInt(0, MAX_WINDOW_RADIUS).optional() }).strict(),
  })
  .transform(({ params, query }) => ({
    segmentId: params.id,
    radius: query.radius ?? DEFAULT_WINDOW_RADIUS,
  }));

/** The segment indexes are small numbers: a street has far fewer than 100,000 segments. */
const MAX_SEGMENT_INDEX = 100_000;

export const roadSummaryInputSchema = z
  .object({
    params: z.object({ id: idParam }).strict(),
    query: z
      .object({
        from: queryInt(0, MAX_SEGMENT_INDEX).optional(),
        to: queryInt(0, MAX_SEGMENT_INDEX).optional(),
      })
      .strict(),
  })
  .superRefine(({ query }, context) => {
    if ((query.from === undefined) !== (query.to === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'send both from and to, or neither',
      });
    } else if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      context.addIssue({
        code: 'custom',
        path: ['query', 'from'],
        message: 'from cannot be after to',
      });
    }
  })
  .transform(({ params, query }) => ({
    roadId: params.id,
    range:
      query.from !== undefined && query.to !== undefined
        ? { from: query.from, to: query.to }
        : undefined,
  }));
