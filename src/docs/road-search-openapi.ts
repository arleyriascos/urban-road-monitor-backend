import { SEARCH_REQUESTS_PER_MINUTE } from '../middlewares/rate-limit.js';
import { MAX_QUERY_LENGTH, MAX_SUGGESTIONS } from '../roads/search-input.js';
import { DEFAULT_SUGGESTIONS } from '../services/road-search.service.js';

/**
 * OpenAPI description of the street search (GET /api/roads/search). It is public and belongs to
 * the Streets tag. The names are kept in a trie in the backend; it is spread into the main
 * document (openapi.ts).
 */
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

export const roadSearchSchemas = {
  StreetMatch: {
    type: 'object',
    description:
      'A street found by its name. The ways that have the same name (OpenStreetMap splits a ' +
      'long street into many) are one street here.',
    properties: {
      name: { type: 'string', example: 'Calle 18' },
      roadIds: {
        type: 'array',
        description: 'The ids of the ways that have this name, to highlight them on the map',
        items: { type: 'integer' },
        example: [7, 12],
      },
      segments: { type: 'integer', example: 24 },
      center: {
        type: 'object',
        description: 'The middle of the box that holds the street, to center the map on',
        properties: {
          latitude: { type: 'number', example: 1.2136 },
          longitude: { type: 'number', example: -77.2811 },
        },
        required: ['latitude', 'longitude'],
      },
      bounds: {
        type: 'object',
        description: 'The box that holds the whole street, to fit the map to',
        properties: {
          minLatitude: { type: 'number' },
          maxLatitude: { type: 'number' },
          minLongitude: { type: 'number' },
          maxLongitude: { type: 'number' },
        },
        required: ['minLatitude', 'maxLatitude', 'minLongitude', 'maxLongitude'],
      },
    },
    required: ['name', 'roadIds', 'segments', 'center', 'bounds'],
  },
  StreetSearchAnswer: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What was searched, without the spaces around it' },
      streets: { type: 'array', items: { $ref: '#/components/schemas/StreetMatch' } },
    },
    required: ['query', 'streets'],
  },
};

export const roadSearchPaths = {
  '/api/roads/search': {
    get: {
      tags: ['Streets'],
      summary: 'Suggest streets by the beginning of their name',
      description:
        'For the search box of the map. It ignores capitals, accents and extra spaces, and ' +
        'answers first the streets whose name starts with the text and then those with a later ' +
        'word that does ("18" finds "18 de Octubre" and then "Calle 18"). Public. Browsers may ' +
        `keep an answer for a minute. At most ${SEARCH_REQUESTS_PER_MINUTE} requests per minute ` +
        'and IP address.',
      parameters: [
        {
          name: 'q',
          in: 'query',
          required: true,
          description: 'What the person has typed so far',
          schema: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
        },
        {
          name: 'limit',
          in: 'query',
          description: 'How many suggestions at most',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_SUGGESTIONS,
            default: DEFAULT_SUGGESTIONS,
          },
        },
      ],
      responses: {
        200: {
          description: 'The suggestions, possibly none.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/StreetSearchAnswer' } },
          },
        },
        400: errorResponse('INVALID_REQUEST: no text, a text that is too long or a wrong limit'),
        429: errorResponse(`TOO_MANY_REQUESTS: more than ${SEARCH_REQUESTS_PER_MINUTE} per minute`),
        503: errorResponse('DATABASE_UNAVAILABLE: try again later'),
      },
    },
  },
};
