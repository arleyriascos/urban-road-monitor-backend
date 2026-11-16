import { AppError } from '../errors/app-error.js';
import { classifySeverity, type SeverityLevel } from '../detections/severity.js';
import { roundDetection } from '../detections/rounding.js';
import { judgeDetections, type Rejected } from '../detections/rules.js';
import type { DetectionBatch } from '../detections/batch-input.js';
import { aiModelRepository, type AiModelRepository } from '../repositories/ai-model.repository.js';
import {
  detectionRepository,
  type DetectionRepository,
  type NewDetection,
} from '../repositories/detection.repository.js';
import {
  parameterRepository,
  type ParameterRepository,
} from '../repositories/parameter.repository.js';
import {
  severityRepository,
  type SeverityRepository,
} from '../repositories/severity.repository.js';
import { tripRepository, type TripRepository } from '../repositories/trip.repository.js';
import { CLOCK_SKEW_MS, acceptsDetections } from '../trips/trip-rules.js';
import {
  consolidationCoordinator,
  type ConsolidationCoordinator,
} from './consolidation-coordinator.js';
import { orUnavailable } from './database-errors.js';
import { DEFAULT_MAX_GPS_ACCURACY_M } from './trip.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A detection older than this is not stored: it is the queue of a phone that was lost for weeks. */
export const MAX_DETECTION_AGE_MS = 14 * DAY_MS;

/** What the phone learns about a batch: what was kept, what was already known, what was refused. */
export interface IngestResult {
  received: number;
  stored: number;
  duplicates: number;
  rejected: Rejected[];
}

export interface DetectionIngestDependencies {
  trips: Pick<TripRepository, 'findOwned'>;
  models: Pick<AiModelRepository, 'findActive'>;
  severities: Pick<SeverityRepository, 'findAll'>;
  detections: Pick<DetectionRepository, 'insertMany'>;
  parameters: Pick<ParameterRepository, 'getNumber'>;
  /** Told when detections were stored, so the consolidation can plan a run. */
  consolidation: Pick<ConsolidationCoordinator, 'notify'>;
  clock: () => Date;
}

/** Receives the detections a phone found on a trip and stores the ones that are good. */
export class DetectionIngestService {
  private readonly deps: DetectionIngestDependencies;

  constructor(deps?: Partial<DetectionIngestDependencies>) {
    this.deps = {
      trips: tripRepository,
      models: aiModelRepository,
      severities: severityRepository,
      detections: detectionRepository,
      parameters: parameterRepository,
      consolidation: consolidationCoordinator,
      clock: () => new Date(),
      ...deps,
    };
  }

  /**
   * Stores a batch of detections on a trip of the person.
   *
   * It can be sent again as many times as needed: a detection that is already stored is counted
   * as a duplicate and left as it was. A detection that breaks a rule is not an error of the
   * request: it comes back in `rejected` with the reason, and the rest of the batch is stored.
   */
  async ingest(userId: string, tripId: string, batch: DetectionBatch): Promise<IngestResult> {
    return orUnavailable('Could not store the detections of a trip', async () => {
      const now = this.deps.clock();
      const trip = await this.deps.trips.findOwned(userId, tripId);
      if (!trip) {
        throw new AppError(404, 'TRIP_NOT_FOUND', 'No trip of yours has that id');
      }
      if (!acceptsDetections(trip, now)) {
        throw new AppError(
          409,
          'TRIP_CLOSED',
          'The trip ended too long ago to take more detections',
        );
      }
      const model = await this.deps.models.findActive();
      if (!model) {
        throw new AppError(503, 'NO_ACTIVE_MODEL', 'There is no active model right now');
      }
      const maxGpsAccuracyM = await this.deps.parameters.getNumber(
        'max_gps_accuracy_m',
        DEFAULT_MAX_GPS_ACCURACY_M,
      );

      const { accepted, rejected } = judgeDetections(batch.detections, {
        now,
        clockSkewMs: CLOCK_SKEW_MS,
        maxAgeMs: MAX_DETECTION_AGE_MS,
        maxGpsAccuracyM,
        minConfidence: model.minConfidence,
        tripStartedAt: trip.startedAt,
      });

      const levels = await this.deps.severities.findAll();
      const rows = accepted.map((detection) => this.toRow(detection, levels));
      const stored = await this.deps.detections.insertMany(tripId, rows, now);
      if (stored > 0) {
        this.tellConsolidation();
      }

      return {
        received: batch.detections.length,
        stored,
        duplicates: rows.length - stored,
        rejected,
      };
    });
  }

  /** The detections are already safe in the table: a problem here must not fail the request. */
  private tellConsolidation(): void {
    try {
      this.deps.consolidation.notify();
    } catch (error) {
      console.error('Could not tell the consolidation about new detections:', error);
    }
  }

  private toRow(
    detection: DetectionBatch['detections'][number],
    levels: SeverityLevel[],
  ): NewDetection {
    const rounded = roundDetection(detection);
    const level = classifySeverity(rounded.bboxAreaRatio, levels);
    if (!level) {
      // The table has a hole: it is the server's fault, not the phone's.
      throw new AppError(500, 'SEVERITY_TABLE_INCOMPLETE', 'No severity level covers this size');
    }
    return {
      id: rounded.id,
      severityLevelId: level.id,
      latitude: rounded.latitude,
      longitude: rounded.longitude,
      gpsAccuracyM: rounded.gpsAccuracyM,
      confidence: rounded.confidence,
      bboxAreaRatio: rounded.bboxAreaRatio,
      detectedAt: rounded.detectedAt,
    };
  }
}

export const detectionIngestService = new DetectionIngestService();
