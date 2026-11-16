import { TRIP_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { DEFAULT_TRIPS_PAGE, MAX_TRIPS_PAGE } from '../trips/list-input.js';

/**
 * OpenAPI description of the trips of a phone: start (POST /api/trips), end
 * (PATCH /api/trips/{id}), list (GET /api/trips) and read one (GET /api/trips/{id}).
 * It is spread into the main document (openapi.ts). The detections of a trip are described
 * in detections-openapi.ts.
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const tripIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'The id of a trip of the person who makes the request',
  schema: { type: 'string', format: 'uuid' },
};

export const tripTags = [
  {
    name: 'Trips',
    description:
      'A trip is one drive with the camera on. The phone starts it, sends the detections it ' +
      'finds, and ends it. Every route needs a session ("Authorization: Bearer <identifier>"): ' +
      'recording needs the permission detections.create and reading the own trips needs ' +
      `trips.view_own. At most ${TRIP_REQUESTS_PER_MINUTE} requests per minute and IP address. ` +
      'A trip of someone else is answered "not found", the same as one that does not exist.',
  },
];

export const tripSchemas = {
  StartTripRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      device: {
        type: 'object',
        additionalProperties: false,
        description: 'The phone. The same phone gets the same device on every trip.',
        properties: {
          platform: { type: 'string', enum: ['android', 'ios', 'other'] },
          browser: { type: 'string', example: 'Chrome 130' },
          label: { type: 'string', example: 'Pixel 7' },
        },
        required: ['platform'],
      },
      modelVersion: {
        type: 'string',
        example: '1.0.0',
        description: 'The version of the model the phone runs. It must be the active one.',
      },
      startedAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When the phone says the trip started. It is believed unless it is in the future ' +
          'or older than two days; then the server time is used.',
      },
    },
    required: ['device', 'modelVersion'],
  },
  StartedTrip: {
    type: 'object',
    properties: {
      tripId: { type: 'string', format: 'uuid' },
      deviceId: { type: 'string', format: 'uuid' },
      startedAt: { type: 'string', format: 'date-time' },
      model: {
        type: 'object',
        properties: {
          version: { type: 'string', example: '1.0.0' },
          minConfidence: {
            type: 'number',
            example: 0.4,
            description: 'Detections with less confidence are refused',
          },
        },
        required: ['version', 'minConfidence'],
      },
      limits: {
        type: 'object',
        properties: {
          maxGpsAccuracyM: {
            type: 'number',
            example: 20,
            description: 'Detections with a worse GPS (a bigger error in meters) are refused',
          },
          maxBatchSize: { type: 'integer', example: 100 },
        },
        required: ['maxGpsAccuracyM', 'maxBatchSize'],
      },
    },
    required: ['tripId', 'deviceId', 'startedAt', 'model', 'limits'],
  },
  EndTripRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      endedAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When the phone says the trip ended. It is believed when it falls between the start ' +
          'and now; otherwise now is used.',
      },
      framesAnalyzed: { type: 'integer', minimum: 0, maximum: 1000000, example: 3600 },
      distanceM: { type: 'number', minimum: 0, maximum: 1000000, example: 1250.5 },
    },
    required: ['framesAnalyzed', 'distanceM'],
  },
  SeverityCount: {
    type: 'object',
    properties: {
      severity: { type: 'string', enum: ['leve', 'moderado', 'grave'] },
      count: { type: 'integer', minimum: 0 },
    },
    required: ['severity', 'count'],
  },
  Trip: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: ['string', 'null'], format: 'date-time' },
      framesAnalyzed: { type: 'integer' },
      distanceM: { type: 'number' },
      detections: {
        type: 'object',
        description: 'The detections stored for the trip; every severity appears, even with 0.',
        properties: {
          total: { type: 'integer' },
          bySeverity: { type: 'array', items: { $ref: '#/components/schemas/SeverityCount' } },
        },
        required: ['total', 'bySeverity'],
      },
    },
    required: ['id', 'startedAt', 'endedAt', 'framesAnalyzed', 'distanceM', 'detections'],
  },
  TripSummary: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: ['string', 'null'], format: 'date-time' },
      framesAnalyzed: { type: 'integer' },
      distanceM: { type: 'number' },
      detectionCount: { type: 'integer' },
      platform: { type: 'string', enum: ['android', 'ios', 'other'] },
      deviceLabel: { type: ['string', 'null'] },
      modelVersion: { type: 'string' },
    },
    required: ['id', 'startedAt', 'endedAt', 'detectionCount', 'platform', 'modelVersion'],
  },
  TripPage: {
    type: 'object',
    properties: {
      trips: { type: 'array', items: { $ref: '#/components/schemas/TripSummary' } },
      nextCursor: {
        type: ['string', 'null'],
        description: 'Pass it as "cursor" to read the next page; null on the last page',
      },
    },
    required: ['trips', 'nextCursor'],
  },
};

export const tripPaths = {
  '/api/trips': {
    post: {
      tags: ['Trips'],
      summary: 'Start a trip',
      description:
        'Opens a trip on the device of the phone (found or created) and answers the rules the ' +
        'detections will be judged by. The model of the phone must be the active one, otherwise ' +
        'the answer is 409 and the phone must update. Sent with "Cache-Control: no-store".',
      security: [{ sessionToken: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/StartTripRequest' } },
        },
      },
      responses: {
        201: {
          description: 'The trip is open.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/StartedTrip' } } },
        },
        400: errorResponse('INVALID_REQUEST or INVALID_JSON: the body is not valid'),
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not record trips (detections.create)'),
        409: errorResponse(
          'MODEL_VERSION_MISMATCH: the phone runs another model; details say which is expected',
        ),
        429: errorResponse(`TOO_MANY_REQUESTS: more than ${TRIP_REQUESTS_PER_MINUTE} per minute`),
        503: errorResponse('NO_ACTIVE_MODEL or DATABASE_UNAVAILABLE: try again later'),
      },
    },
    get: {
      tags: ['Trips'],
      summary: 'List my trips',
      description:
        'The trips of the person, newest first, with how many detections each has. Page by ' +
        'page: pass the "nextCursor" of an answer as the "cursor" of the next request.',
      security: [{ sessionToken: [] }],
      parameters: [
        {
          name: 'limit',
          in: 'query',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_TRIPS_PAGE,
            default: DEFAULT_TRIPS_PAGE,
          },
        },
        { name: 'cursor', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'A page of trips.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TripPage' } } },
        },
        400: errorResponse('INVALID_REQUEST (bad limit) or INVALID_CURSOR'),
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not read trips (trips.view_own)'),
        429: errorResponse(`TOO_MANY_REQUESTS: more than ${TRIP_REQUESTS_PER_MINUTE} per minute`),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
  '/api/trips/{id}': {
    patch: {
      tags: ['Trips'],
      summary: 'End a trip',
      description:
        'Closes the trip with its frames and distance. It may be sent again if the answer got ' +
        'lost: the trip that is already closed is answered as it was closed the first time. ' +
        'Detections of the trip are still taken for 24 hours after it ends.',
      security: [{ sessionToken: [] }],
      parameters: [tripIdParameter],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/EndTripRequest' } },
        },
      },
      responses: {
        200: {
          description: 'The trip as stored.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Trip' } } },
        },
        400: errorResponse('INVALID_REQUEST or INVALID_JSON: the body is not valid'),
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not record trips (detections.create)'),
        404: errorResponse('TRIP_NOT_FOUND: no trip of the person has that id'),
        429: errorResponse(`TOO_MANY_REQUESTS: more than ${TRIP_REQUESTS_PER_MINUTE} per minute`),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
    get: {
      tags: ['Trips'],
      summary: 'Read one of my trips',
      security: [{ sessionToken: [] }],
      parameters: [tripIdParameter],
      responses: {
        200: {
          description: 'The trip with its detections counted by severity.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Trip' } } },
        },
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not read trips (trips.view_own)'),
        404: errorResponse('TRIP_NOT_FOUND: no trip of the person has that id'),
        429: errorResponse(`TOO_MANY_REQUESTS: more than ${TRIP_REQUESTS_PER_MINUTE} per minute`),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
};
