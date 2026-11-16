import { DETECTION_BATCHES_PER_MINUTE } from '../middlewares/rate-limit.js';
import { MAX_BATCH_SIZE } from '../detections/batch-input.js';

/**
 * OpenAPI description of the batches of detections a phone sends on a trip
 * (POST /api/trips/{tripId}/detections). It is spread into the main document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const detectionSchemas = {
  DetectionInput: {
    type: 'object',
    additionalProperties: false,
    description:
      'One pothole the phone saw. The phone does not say how severe it is: the server works ' +
      'it out from the share of the picture the box covers (under 1 % leve, from 1 % to under ' +
      '4 % moderado, from 4 % grave).',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Made by the phone. Sending the same id again changes nothing.',
      },
      latitude: { type: 'number', minimum: -90, maximum: 90, example: 1.2136 },
      longitude: { type: 'number', minimum: -180, maximum: 180, example: -77.2811 },
      gpsAccuracyM: {
        type: 'number',
        minimum: 0,
        maximum: 100000,
        description: 'Error of the GPS in meters, when the phone knows it',
        example: 6.5,
      },
      confidence: { type: 'number', minimum: 0, maximum: 1, example: 0.82 },
      bboxAreaRatio: {
        type: 'number',
        exclusiveMinimum: 0,
        maximum: 1,
        description: 'The share of the picture the box covers',
        example: 0.02,
      },
      detectedAt: { type: 'string', format: 'date-time', example: '2026-11-16T12:00:00-05:00' },
    },
    required: ['id', 'latitude', 'longitude', 'confidence', 'bboxAreaRatio', 'detectedAt'],
  },
  DetectionBatch: {
    type: 'object',
    additionalProperties: false,
    properties: {
      detections: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_SIZE,
        description: 'Without repeated ids',
        items: { $ref: '#/components/schemas/DetectionInput' },
      },
    },
    required: ['detections'],
  },
  RejectedDetection: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      reason: {
        type: 'string',
        enum: ['in_the_future', 'too_old', 'before_trip', 'gps_not_accurate', 'low_confidence'],
        description:
          'in_the_future: more than 2 minutes ahead of the server. too_old: more than 14 days ' +
          'old. before_trip: older than the start of the trip. gps_not_accurate: a GPS error ' +
          'bigger than the limit the trip announced. low_confidence: under the minimum of the ' +
          'model. The phone drops a rejected detection: sending it again gets the same answer.',
      },
    },
    required: ['id', 'reason'],
  },
  DetectionBatchResult: {
    type: 'object',
    properties: {
      received: { type: 'integer', description: 'How many detections came in the batch' },
      stored: { type: 'integer', description: 'How many were new and stored' },
      duplicates: {
        type: 'integer',
        description: 'How many were good but already stored: left as they were',
      },
      rejected: { type: 'array', items: { $ref: '#/components/schemas/RejectedDetection' } },
    },
    required: ['received', 'stored', 'duplicates', 'rejected'],
  },
};

export const detectionPaths = {
  '/api/trips/{tripId}/detections': {
    post: {
      tags: ['Trips'],
      summary: 'Send a batch of detections of a trip',
      description:
        `Up to ${MAX_BATCH_SIZE} detections at a time; at most ${DETECTION_BATCHES_PER_MINUTE} ` +
        'batches per minute and IP address. The good ones are stored, the others come back in ' +
        '"rejected" with the reason: a bad detection is not an error of the request. The batch ' +
        'can be sent again as many times as needed (a lost answer, a phone that comes back ' +
        'online): what is already stored counts as "duplicates" and is not overwritten. The ' +
        'trip takes detections while it is open and for 24 hours after it ended.',
      security: [{ sessionToken: [] }],
      parameters: [
        {
          name: 'tripId',
          in: 'path',
          required: true,
          description: 'A trip of the person who makes the request',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/DetectionBatch' } },
        },
      },
      responses: {
        200: {
          description: 'What was stored and what was refused.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DetectionBatchResult' } },
          },
        },
        400: errorResponse(
          'INVALID_REQUEST or INVALID_JSON: the body is not valid (empty, over the limit, a ' +
            'repeated id, a field that is not allowed). The body limit is 100 kB.',
        ),
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not record trips (detections.create)'),
        404: errorResponse('TRIP_NOT_FOUND: no trip of the person has that id'),
        409: errorResponse('TRIP_CLOSED: the trip ended more than 24 hours ago'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${DETECTION_BATCHES_PER_MINUTE} batches in a minute`,
        ),
        503: errorResponse('NO_ACTIVE_MODEL or DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
};
