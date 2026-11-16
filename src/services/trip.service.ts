import { AppError } from '../errors/app-error.js';
import type { ActiveModel, AiModelRepository } from '../repositories/ai-model.repository.js';
import { deviceRepository, type DeviceRepository } from '../repositories/device.repository.js';
import { aiModelRepository } from '../repositories/ai-model.repository.js';
import {
  parameterRepository,
  type ParameterRepository,
} from '../repositories/parameter.repository.js';
import { tripRepository, type TripRepository } from '../repositories/trip.repository.js';
import { MAX_BATCH_SIZE } from '../detections/batch-input.js';
import { chooseStartedAt } from '../trips/trip-rules.js';
import type { StartTripInput } from '../trips/trip-input.js';
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

export interface TripServiceDependencies {
  models: Pick<AiModelRepository, 'findActive'>;
  devices: Pick<DeviceRepository, 'findOrCreate'>;
  trips: Pick<TripRepository, 'create'>;
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

  private async activeModel(): Promise<ActiveModel> {
    const model = await this.deps.models.findActive();
    if (!model) {
      throw new AppError(503, 'NO_ACTIVE_MODEL', 'There is no active vision model right now');
    }
    return model;
  }
}

export const tripService = new TripService();
