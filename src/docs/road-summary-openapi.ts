import { MAX_WINDOW_RADIUS, DEFAULT_WINDOW_RADIUS } from '../roads/summary-input.js';
import { SUMMARY_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';

/**
 * OpenAPI description of the street summaries: the "window" of a segment
 * (GET /api/road-segments/{id}/summary) and a whole street or a stretch of it
 * (GET /api/roads/{id}/summary). They are public. Each street is a segment tree in memory, so
 * any stretch is answered in O(log n). It is spread into the main document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const roadSummaryTags = [
  {
    name: 'Streets',
    description:
      'How the potholes are along a street: how many there are, the damage they add up to and ' +
      'the worst severity, for a whole street or for a stretch of it. Public. The answers follow ' +
      'the database within 10 seconds, and browsers may keep them for 10 seconds. At most ' +
      `${SUMMARY_REQUESTS_PER_MINUTE} requests per minute and IP address.`,
  },
];

export const roadSummarySchemas = {
  StretchSummary: {
    type: 'object',
    description: 'A stretch of a street, added up.',
    properties: {
      segments: { type: 'integer', example: 5 },
      lengthM: { type: 'number', example: 412.5 },
      visiblePotholes: {
        type: 'integer',
        description: 'Potholes that are not repaired: the ones the map draws',
        example: 3,
      },
      confirmedPotholes: {
        type: 'integer',
        description: 'Potholes seen at least twice: the only ones that change the damage',
        example: 2,
      },
      damageScore: {
        type: 'number',
        description: 'The damage of the segments added up (severity weight x confidence)',
        example: 3.5,
      },
      worstSeverity: {
        type: ['object', 'null'],
        description: 'The worst severity among the confirmed potholes, or null if there is none',
        properties: {
          name: { type: 'string', enum: ['leve', 'moderado', 'grave'] },
          weight: { type: 'number', example: 6 },
        },
      },
    },
    required: ['segments', 'lengthM', 'visiblePotholes', 'confirmedPotholes', 'damageScore'],
  },
  StreetStretch: {
    type: 'object',
    properties: {
      roadId: { type: 'integer', example: 7 },
      roadName: { type: ['string', 'null'], example: 'Calle 18' },
      fromSegmentIndex: {
        type: ['integer', 'null'],
        description: 'The first segment of the stretch, by its place in the street; null if empty',
      },
      toSegmentIndex: { type: ['integer', 'null'] },
      summary: { $ref: '#/components/schemas/StretchSummary' },
    },
    required: ['roadId', 'roadName', 'fromSegmentIndex', 'toSegmentIndex', 'summary'],
  },
  SegmentWindow: {
    type: 'object',
    properties: {
      segment: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          roadId: { type: 'integer' },
          roadName: { type: ['string', 'null'] },
          position: { type: 'integer', description: 'Its place in the street, from 1', example: 3 },
          segmentsInRoad: { type: 'integer', example: 12 },
        },
        required: ['id', 'roadId', 'roadName', 'position', 'segmentsInRoad'],
      },
      radius: { type: 'integer' },
      window: {
        description: 'The segment and the `radius` segments before and after it',
        $ref: '#/components/schemas/StreetStretch',
      },
      road: { description: 'The whole street', $ref: '#/components/schemas/StreetStretch' },
    },
    required: ['segment', 'radius', 'window', 'road'],
  },
};

export const roadSummaryPaths = {
  '/api/road-segments/{id}/summary': {
    get: {
      tags: ['Streets'],
      summary: 'The window of a segment: the stretch around it and its whole street',
      description:
        'For the popup of a segment. It answers the segment, the stretch made of it and the ' +
        '`radius` segments on each side, and the whole street.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'The id of a road segment (the "segmentId" of the map)',
          schema: { type: 'integer', minimum: 1 },
        },
        {
          name: 'radius',
          in: 'query',
          schema: {
            type: 'integer',
            minimum: 0,
            maximum: MAX_WINDOW_RADIUS,
            default: DEFAULT_WINDOW_RADIUS,
          },
        },
      ],
      responses: {
        200: {
          description: 'The window of the segment.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SegmentWindow' } },
          },
        },
        400: errorResponse('INVALID_REQUEST: a wrong id, radius or parameter'),
        404: errorResponse('SEGMENT_NOT_FOUND: there is no segment with that id'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${SUMMARY_REQUESTS_PER_MINUTE} per minute`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
  '/api/roads/{id}/summary': {
    get: {
      tags: ['Streets'],
      summary: 'A whole street, or the segments of it between two places',
      description:
        'Without "from" and "to" it adds up the whole street. With them it adds up the ' +
        'segments whose place in the street is between the two, both included. A range with no ' +
        'segments answers an empty stretch (zero segments), not an error.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: 'The id of a street (the "roadId" of a segment)',
          schema: { type: 'integer', minimum: 1 },
        },
        { name: 'from', in: 'query', schema: { type: 'integer', minimum: 0 } },
        { name: 'to', in: 'query', schema: { type: 'integer', minimum: 0 } },
      ],
      responses: {
        200: {
          description: 'The street, or the stretch of it.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/StreetStretch' } },
          },
        },
        400: errorResponse(
          'INVALID_REQUEST: a wrong id, only one of from and to, or from after to',
        ),
        404: errorResponse('ROAD_NOT_FOUND: there is no street with that id'),
        429: errorResponse(
          `TOO_MANY_REQUESTS: more than ${SUMMARY_REQUESTS_PER_MINUTE} per minute`,
        ),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
};
