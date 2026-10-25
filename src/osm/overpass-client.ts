import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  CACHE_DIRECTORY,
  OVERPASS_ENDPOINTS,
  OVERPASS_USER_AGENT,
  type BoundingBox,
} from './config.js';
import { boundingBoxKey } from './bbox.js';
import { buildOverpassQuery } from './query.js';
import type { OverpassResponse } from './types.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 120_000;

export interface OverpassClientOptions {
  endpoints?: readonly string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  requestTimeoutMs?: number;
  cacheDirectory?: string;
  log?: (message: string) => void;
}

export interface LoadOverpassOptions extends OverpassClientOptions {
  /** Download again even if the data is already saved on this computer. */
  refresh?: boolean;
}

export interface LoadedOverpassData {
  response: OverpassResponse;
  source: 'cache' | 'download';
  cacheFile: string;
  sizeBytes: number;
}

/** Problem that is worth trying again (busy server, timeout, broken answer). */
class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : undefined;
}

/** One request to one Overpass server. Throws RetryableError or a final Error. */
async function requestOnce(
  endpoint: string,
  query: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': OVERPASS_USER_AGENT,
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RetryableError(`no hubo conexión con el servidor (${describeError(error)})`);
  }

  const body = await response.text();

  if (!response.ok) {
    const detail = `el servidor respondió ${response.status}`;
    if (RETRYABLE_STATUS.has(response.status)) {
      throw new RetryableError(detail, parseRetryAfter(response.headers.get('retry-after')));
    }
    throw new Error(`${detail}: ${body.slice(0, 300)}`);
  }

  let parsed: OverpassResponse;
  try {
    parsed = JSON.parse(body) as OverpassResponse;
  } catch {
    throw new RetryableError('la respuesta no es un JSON válido (servidor sobrecargado)');
  }

  if (parsed.remark && /runtime error|timed out|out of memory/i.test(parsed.remark)) {
    throw new RetryableError(`Overpass no pudo terminar la consulta: ${parsed.remark}`);
  }
  if (!Array.isArray(parsed.elements)) {
    throw new RetryableError('la respuesta no trae la lista de elementos');
  }

  return body;
}

/** Downloads the raw JSON text, retrying and rotating between servers. */
async function download(query: string, options: OverpassClientOptions): Promise<string> {
  const endpoints = options.endpoints ?? OVERPASS_ENDPOINTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 5_000;
  const timeoutMs = options.requestTimeoutMs ?? 240_000;
  const log = options.log ?? (() => undefined);

  let lastProblem = 'sin detalles';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const endpoint = endpoints[(attempt - 1) % endpoints.length];
    log(`Descargando desde ${new URL(endpoint).host} (intento ${attempt} de ${maxAttempts})...`);

    try {
      return await requestOnce(endpoint, query, fetchImpl, timeoutMs);
    } catch (error) {
      if (!(error instanceof RetryableError)) throw error;
      lastProblem = error.message;
      if (attempt < maxAttempts) {
        const delayMs = error.retryAfterMs ?? baseDelayMs * 3 ** (attempt - 1);
        log(`Falló: ${lastProblem}. Reintentando en ${Math.round(delayMs / 1000)} s...`);
        await sleep(delayMs);
      }
    }
  }

  throw new Error(
    `No se pudo descargar la información de OpenStreetMap tras ${maxAttempts} intentos. ` +
      `Último problema: ${lastProblem}. Espera unos minutos y vuelve a intentarlo.`,
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the OpenStreetMap data for the rectangle. If it was downloaded before it is
 * read from disk, so running the import again does not call the Overpass servers.
 */
export async function loadOverpassData(
  bbox: BoundingBox,
  options: LoadOverpassOptions = {},
): Promise<LoadedOverpassData> {
  const cacheFile = join(
    options.cacheDirectory ?? CACHE_DIRECTORY,
    `overpass-${boundingBoxKey(bbox)}.json`,
  );
  const log = options.log ?? (() => undefined);

  if (!options.refresh && (await fileExists(cacheFile))) {
    log(`Usando los datos guardados en ${cacheFile}`);
    const text = await readFile(cacheFile, 'utf8');
    try {
      return {
        response: JSON.parse(text) as OverpassResponse,
        source: 'cache',
        cacheFile,
        sizeBytes: Buffer.byteLength(text),
      };
    } catch {
      throw new Error(
        `El archivo ${cacheFile} está dañado. Bórralo o ejecuta de nuevo con --refresh.`,
      );
    }
  }

  const text = await download(buildOverpassQuery(bbox), options);

  await mkdir(dirname(cacheFile), { recursive: true });
  const temporaryFile = `${cacheFile}.tmp`;
  await writeFile(temporaryFile, text);
  await rename(temporaryFile, cacheFile);

  return {
    response: JSON.parse(text) as OverpassResponse,
    source: 'download',
    cacheFile,
    sizeBytes: Buffer.byteLength(text),
  };
}
