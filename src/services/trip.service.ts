import { AppError } from '../errors/app-error.js';
import type { ActiveModel, AiModelRepository } from '../repositories/ai-model.repository.js';
import { deviceRepository, type DeviceRepository } from '../repositories/device.repository.js';
import { aiModelRepository } from '../repositories/ai-model.repository.js';
import {
  parameterRepository,
  type ParameterRepository,
} from '../repositories/parameter.repository.js';
import {
  detectionRepository,
  type DetectionRepository,
  type TripDetectionCount,
} from '../repositories/detection.repository.js';
import {
  tripRepository,
  type TripRecord,
  type TripRepository,
  type TripSummary,
} from '../repositories/trip.repository.js';
import { MAX_BATCH_SIZE } from '../detections/batch-input.js';
import { decodeCursor, encodeCursor } from '../trips/cursor.js';
import { chooseEndedAt, chooseStartedAt } from '../trips/trip-rules.js';
import type { EndTripInput, StartTripInput } from '../trips/trip-input.js';
import { orUnavailable } from './database-errors.js';

/** The GPS accuracy accepted when the table of parameters does not say otherwise. */
export const DEFAULT_MAX_GPS_ACCURACY_M = 20;

/** What the phone gets when a trip starts: the trip and the rules it will be judged by. */
export interface StartedTrip {
  tripId: string;
  deviceId: string;
  startedAt: Date;
  model: { version: string; minConfidence: number };
  limits: { maxGpsAccuracyM: number; maxBatchSize: number };
}

/** A trip as the phone sees it. */
export interface TripView {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  framesAnalyzed: number;
  distanceM: number;
  detections: TripDetectionCount;
}

/** One page of the trips of a person. */
export interface TripPage {
  trips: TripSummary[];
  /** Pass it back to read the next page; null when this was the last one. */
  nextCursor: string | null;
}

export interface TripServiceDependencies {
  models: Pick<AiModelRepository, 'findActive'>;
  devices: Pick<DeviceRepository, 'findOrCreate'>;
  trips: Pick<TripRepository, 'create' | 'findOwned' | 'finish' | 'listByUser'>;
  detections: Pick<DetectionRepository, 'countByTrip'>;
  parameters: Pick<ParameterRepository, 'getNumber'>;
  clock: () => Date;
}

/** Starts, closes and lists the trips of a person. */
export class TripService {
  private readonly deps: TripServiceDependencies;

  constructor(deps: Partial<TripServiceDependencies> = {}) {
    this.deps = {
      models: aiModelRepository,
      devices: deviceRepository,
      trips: tripRepository,
      detections: detectionRepository,
      parameters: parameterRepository,
      clock: () => new Date(),
      ...deps,
    };
  }

  /**
   * Starts a trip. The model the phone runs must be the active one: a detection made by an
   * old model is judged by another threshold, so the phone is told to update first.
   */
  async start(userId: string, input: StartTripInput): Promise<StartedTrip> {
    return orUnavailable('Could not start a trip', async () => {
      const model = await this.activeModel();
      if (input.modelVersion !== model.version) {
        throw new AppError(
          409,
          'MODEL_VERSION_MISMATCH',
          `The active model is ${model.version}, not ${input.modelVersion}; reload the app to update it`,
          { expected: model.version, received: input.modelVersion },
        );
      }

      const now = this.deps.clock();
      const startedAt = chooseStartedAt(input.startedAt, now);
      const device = await this.deps.devices.findOrCreate(userId, input.device, now);
      const trip = await this.deps.trips.create({
        userId,
        deviceId: device.id,
        aiModelId: model.id,
        startedAt,
      });
      const maxGpsAccuracyM = await this.deps.parameters.getNumber(
        'max_gps_accuracy_m',
        DEFAULT_MAX_GPS_ACCURACY_M,
      );

      return {
        tripId: trip.id,
        deviceId: device.id,
        startedAt: trip.startedAt,
        model: { version: model.version, minConfidence: model.minConfidence },
        limits: { maxGpsAccuracyM, maxBatchSize: MAX_BATCH_SIZE },
      };
    });
  }

  /**
   * Closes a trip of the person with its counters, and answers the trip as it is.
   *
   * It is safe to send twice: a phone that did not hear the answer sends it again, and the trip
   * that is already closed is answered as it was closed the first time, without changes. The
   * trip of someone else is "not found", the same as one that does not exist.
   */
  async finish(userId: string, tripId: string, input: EndTripInput): Promise<TripView> {
    return orUnavailable('Could not close a trip', async () => {
      const trip = await this.deps.trips.findOwned(userId, tripId);
      if (!trip) {
        throw tripNotFound();
      }
      if (trip.endedAt === null) {
        const endedAt = chooseEndedAt(input.endedAt, trip.startedAt, this.deps.clock());
        await this.deps.trips.finish(userId, tripId, {
          endedAt,
          framesAnalyzed: input.framesAnalyzed,
          distanceM: input.distanceM,
        });
      }
      // Read again: it is the trip as stored, whoever closed it (this call or a faster twin).
      const closed = await this.deps.trips.findOwned(userId, tripId);
      if (!closed) {
        throw tripNotFound();
      }
      return this.view(closed);
    });
  }

  /** The trip of the person, with its detections counted by severity. */
  async get(userId: string, tripId: string): Promise<TripView> {
    return orUnavailable('Could not read a trip', async () => {
      const trip = await this.deps.trips.findOwned(userId, tripId);
      if (!trip) {
        throw tripNotFound();
      }
      return this.view(trip);
    });
  }

  /** The trips of the person, newest first, `limit` at a time. */
  async list(userId: string, limit: number, cursorText: string | undefined): Promise<TripPage> {
    const cursor = cursorText === undefined ? null : decodeCursor(cursorText);
    if (cursorText !== undefined && cursor === null) {
      throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not one this server gave');
    }
    return orUnavailable('Could not list the trips', async () => {
      // One more than asked: if it comes, there is a next page.
      const rows = await this.deps.trips.listByUser(userId, limit + 1, cursor);
      const trips = rows.slice(0, limit);
      const last = trips[trips.length - 1];
      const hasMore = rows.length > limit && last !== undefined;
      return {
        trips,
        nextCursor: hasMore ? encodeCursor({ startedAt: last.startedAt, id: last.id }) : null,
      };
    });
  }

  private async view(trip: TripRecord): Promise<TripView> {
    return {
      id: trip.id,
      startedAt: trip.startedAt,
      endedAt: trip.endedAt,
      framesAnalyzed: trip.framesAnalyzed,
      distanceM: trip.distanceM,
      detections: await this.deps.detections.countByTrip(trip.id),
    };
  }

  private async activeModel(): Promise<ActiveModel> {
    const model = await this.deps.models.findActive();
    if (!model) {
      throw new AppError(503, 'NO_ACTIVE_MODEL', 'There is no active vision model right now');
    }
    return model;
  }
}

function tripNotFound(): AppError {
  return new AppError(404, 'TRIP_NOT_FOUND', 'No trip of yours has that id');
}

export const tripService = new TripService();
