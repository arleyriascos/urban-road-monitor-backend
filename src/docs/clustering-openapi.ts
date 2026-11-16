import { CLUSTERING_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { DEFAULT_RUNS_PAGE, MAX_RUNS_PAGE } from '../controllers/clustering.controller.js';

/**
 * OpenAPI description of the consolidation of detections into potholes, for the administrator:
 * start a run (POST /api/clustering/runs) and read how the runs went (GET). It is spread into the
 * main document (openapi.ts). The runs of the consolidation are done by the server on its own
 * after new detections arrive; the button only starts one without waiting.
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const clusteringTags = [
  {
    name: 'Clustering',
    description:
      'The consolidation groups the detections of the phones into potholes (DBSCAN, in the AI ' +
      'service) and keeps the status of each pothole and the damage of each street up to date. ' +
      'The server does it by itself a few seconds after new detections arrive (never more than ' +
      'once every two minutes) and tries again if the AI service is asleep. These routes need a ' +
      `session and the permission clustering.run. At most ${CLUSTERING_REQUESTS_PER_MINUTE} requests per minute and IP address.`,
  },
];

const count = (description: string, example: number) => ({ type: 'integer', description, example });

export const clusteringSchemas = {
  ClusteringRun: {
    type: 'object',
    description: 'One consolidation, as it was recorded.',
    properties: {
      id: { type: 'integer', example: 12 },
      status: { type: 'string', enum: ['running', 'finished', 'failed'] },
      trigger: {
        type: 'string',
        enum: ['automatic', 'manual'],
        description: 'automatic after new detections, manual from the administrator',
      },
      requestedBy: { type: ['string', 'null'], format: 'uuid' },
      epsM: { type: 'number', description: 'Distance in meters that joins two detections' },
      minPoints: { type: 'integer', description: 'Detections needed to confirm a pothole' },
      windowDays: { type: ['integer', 'null'], description: 'Days of detections that were read' },
      detectionsProcessed: count('Detections read', 120),
      clustersFound: count('Potholes the AI service found', 30),
      potholesCreated: count('New potholes', 4),
      potholesUpdated: count('Potholes that kept their id and were updated', 26),
      potholesRemoved: count('Potholes that no detection supports any more', 1),
      startedAt: { type: 'string', format: 'date-time' },
      finishedAt: { type: ['string', 'null'], format: 'date-time' },
      errorCode: {
        type: ['string', 'null'],
        description: 'Why a failed run failed, for example AI_HIBERNATING or AI_UNAVAILABLE',
      },
      errorMessage: { type: ['string', 'null'] },
    },
    required: ['id', 'status', 'trigger', 'startedAt'],
  },
  ClusteringStatus: {
    type: 'object',
    properties: {
      running: { type: 'boolean', description: 'A run is going on in this server' },
      nextRunAt: {
        type: ['string', 'null'],
        format: 'date-time',
        description: 'When the next automatic run is planned, if one is',
      },
      failuresInARow: {
        type: 'integer',
        description: 'Failed runs since the last good one; the retry pause grows with it',
      },
      pendingDetections: {
        type: 'integer',
        description: 'Detections that arrived after the last good run began',
      },
    },
    required: ['running', 'nextRunAt', 'failuresInARow', 'pendingDetections'],
  },
  ClusteringOverview: {
    type: 'object',
    properties: {
      status: { $ref: '#/components/schemas/ClusteringStatus' },
      runs: { type: 'array', items: { $ref: '#/components/schemas/ClusteringRun' } },
    },
    required: ['status', 'runs'],
  },
  StartedClustering: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['started'] },
      message: { type: 'string' },
    },
    required: ['status'],
  },
};

export const clusteringPaths = {
  '/api/clustering/runs': {
    post: {
      tags: ['Clustering'],
      summary: 'Start a consolidation now',
      description:
        'Starts a run without waiting for the pause between automatic ones. It answers 202 at ' +
        'once and the run goes on in the background: read GET to see how it ends. Answered 409 ' +
        'while a run is going on.',
      security: [{ sessionToken: [] }],
      responses: {
        202: {
          description: 'The run started.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/StartedClustering' } },
          },
        },
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not run it (clustering.run)'),
        409: errorResponse('RUN_IN_PROGRESS: a consolidation is already running'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${CLUSTERING_REQUESTS_PER_MINUTE} per minute`,
        ),
        503: errorResponse('CLUSTERING_UNAVAILABLE: the AI service is not configured'),
      },
    },
    get: {
      tags: ['Clustering'],
      summary: 'State of the consolidation and latest runs',
      description:
        'The state (is it running, when is the next run, how many detections wait) and the ' +
        'latest runs, newest first, with how each ended. Sent with "Cache-Control: no-store".',
      security: [{ sessionToken: [] }],
      parameters: [
        {
          name: 'limit',
          in: 'query',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_RUNS_PAGE,
            default: DEFAULT_RUNS_PAGE,
          },
        },
      ],
      responses: {
        200: {
          description: 'The state and the runs.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClusteringOverview' } },
          },
        },
        400: errorResponse('INVALID_REQUEST: a wrong limit or an unknown parameter'),
        401: errorResponse('UNAUTHORIZED: no valid session'),
        403: errorResponse('FORBIDDEN: the person may not read it (clustering.run)'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${CLUSTERING_REQUESTS_PER_MINUTE} per minute`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
};
