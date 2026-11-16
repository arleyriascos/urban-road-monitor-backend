import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error.js';
import { detectionBatchSchema } from '../detections/batch-input.js';
import { getAuth } from '../middlewares/require-session.js';
import { listTripsQuerySchema } from '../trips/list-input.js';
import { endTripSchema, startTripSchema } from '../trips/trip-input.js';
import {
  detectionIngestService,
  type DetectionIngestService,
} from '../services/detection-ingest.service.js';
import { tripService, type TripService } from '../services/trip.service.js';

/** Reads `data` with the schema, or answers 400 with what is wrong, field by field. */
function parse<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(
      400,
      'INVALID_REQUEST',
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}

/** The trips of a person and the detections they find on them. Every route needs a session. */
export class TripController {
  constructor(
    private readonly trips: Pick<TripService, 'start' | 'finish' | 'list' | 'get'> = tripService,
    private readonly ingest: Pick<DetectionIngestService, 'ingest'> = detectionIngestService,
  ) {}

  /** POST /api/trips: opens a trip and tells the phone the rules it will be judged by. */
  start = async (req: Request, res: Response) => {
    const input = parse(startTripSchema, req.body);
    const started = await this.trips.start(getAuth(res).userId, input);
    res.set('Cache-Control', 'no-store').status(201).json(started);
  };

  /** PATCH /api/trips/:id: closes the trip. Sending it twice answers the same trip. */
  finish = async (req: Request, res: Response) => {
    const input = parse(endTripSchema, req.body);
    const trip = await this.trips.finish(getAuth(res).userId, String(req.params.id), input);
    res.set('Cache-Control', 'no-store').status(200).json(trip);
  };

  /** GET /api/trips: the trips of the person, newest first, page by page. */
  list = async (req: Request, res: Response) => {
    const query = parse(listTripsQuerySchema, req.query);
    const page = await this.trips.list(getAuth(res).userId, query.limit, query.cursor);
    res.set('Cache-Control', 'no-store').status(200).json(page);
  };

  /** GET /api/trips/:id: one trip of the person with its detections counted by severity. */
  get = async (req: Request, res: Response) => {
    const trip = await this.trips.get(getAuth(res).userId, String(req.params.id));
    res.set('Cache-Control', 'no-store').status(200).json(trip);
  };

  /** POST /api/trips/:tripId/detections: a batch of detections; it may be sent again. */
  addDetections = async (req: Request, res: Response) => {
    const batch = parse(detectionBatchSchema, req.body);
    const result = await this.ingest.ingest(getAuth(res).userId, String(req.params.tripId), batch);
    res.set('Cache-Control', 'no-store').status(200).json(result);
  };
}

export const tripController = new TripController();
