import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleAuthLibraryVerifier } from '../auth/google-token-verifier.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { errorHandler } from '../middlewares/error-handler.js';
import { requirePermission } from '../middlewares/require-permission.js';
import { requireSession } from '../middlewares/require-session.js';
import { AccountRepository } from '../repositories/account.repository.js';
import { AiModelRepository } from '../repositories/ai-model.repository.js';
import { AuthLogRepository } from '../repositories/auth-log.repository.js';
import { DetectionRepository } from '../repositories/detection.repository.js';
import { DeviceRepository } from '../repositories/device.repository.js';
import { ParameterRepository } from '../repositories/parameter.repository.js';
import { RoleAdminRepository } from '../repositories/role-admin.repository.js';
import { SessionRepository } from '../repositories/session.repository.js';
import { SeverityRepository } from '../repositories/severity.repository.js';
import { TripRepository } from '../repositories/trip.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { createAuthRouter } from '../routes/auth.routes.js';
import { createTripRouter } from '../routes/trip.routes.js';
import { AccountService } from '../services/account.service.js';
import { DetectionIngestService } from '../services/detection-ingest.service.js';
import { GoogleLoginService } from '../services/google-login.service.js';
import { SessionService } from '../services/session.service.js';
import { TripService } from '../services/trip.service.js';
import { FakeGoogle, TEST_CLIENT_ID } from '../test/google-test-keys.js';
import { createTestClient, resetDatabase, testDatabaseUrl } from '../test/test-database.js';
import { AuthController } from './auth.controller.js';
import { TripController } from './trip.controller.js';

/**
 * A trip from the point of view of the phone, against a real PostgreSQL: sign in, start the trip,
 * send detections (twice, as a phone does when an answer is lost), close the trip, read it back,
 * and what a stranger or a person without the role sees. Skipped without TEST_DATABASE_URL.
 */
const url = testDatabaseUrl();

interface Json {
  [key: string]: unknown;
}

describe.skipIf(!url)('trips and detections, end to end (real database)', () => {
  let db: PrismaClient;
  let google: FakeGoogle;
  let baseUrl: string;
  let close: () => Promise<unknown>;

  beforeAll(async () => {
    db = createTestClient(url!);
    google = new FakeGoogle();
    const authLogs = new AuthLogRepository(db);
    const sessions = new SessionService(new SessionRepository(db), authLogs);
    const accounts = new AccountService(new AccountRepository(db));
    const login = new GoogleLoginService(
      new GoogleAuthLibraryVerifier(TEST_CLIENT_ID, google.client()),
      new UserRepository(db),
      sessions,
      authLogs,
    );
    const trips = new TripRepository(db);
    const detections = new DetectionRepository(db);
    const models = new AiModelRepository(db);
    const parameters = new ParameterRepository(db);
    const controller = new TripController(
      new TripService({
        models,
        devices: new DeviceRepository(db),
        trips,
        detections,
        parameters,
        clock: () => new Date(),
      }),
      new DetectionIngestService({
        trips,
        models,
        severities: new SeverityRepository(db),
        detections,
        parameters,
        clock: () => new Date(),
      }),
    );

    const open = (_req: unknown, _res: unknown, next: () => void) => next();
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createAuthRouter(
        new AuthController(login, accounts, sessions),
        open,
        requireSession(sessions),
      ),
    );
    app.use(
      '/api',
      createTripRouter(
        controller,
        { trips: open, detections: open },
        {
          create: requirePermission('detections.create', { sessions, accounts }),
          viewOwn: requirePermission('trips.view_own', { sessions, accounts }),
        },
      ),
    );
    app.use(errorHandler);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(resolve));
  });

  afterAll(async () => {
    await close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json };
  }

  /** A person signed in. With `collaborator` they may record trips. */
  async function person(email: string, collaborator = true): Promise<string> {
    const signed = await call('POST', '/api/auth/google', undefined, {
      credential: google.idToken({ email, sub: `sub-${email}` }),
    });
    expect(signed.status).toBe(200);
    if (collaborator) {
      await new RoleAdminRepository(db).change(
        { action: 'add', email, role: 'colaborador' },
        new Date(),
      );
    }
    return signed.body.token as string;
  }

  const start = (token: string, extra: Json = {}) =>
    call('POST', '/api/trips', token, {
      device: { platform: 'android', browser: 'Chrome', label: 'Pixel' },
      modelVersion: '1.0.0',
      ...extra,
    });

  const seen = (n: number, extra: Json = {}) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    latitude: 1.2136,
    longitude: -77.2811,
    gpsAccuracyM: 6.5,
    confidence: 0.82,
    bboxAreaRatio: 0.02,
    detectedAt: new Date(Date.now() - 30_000).toISOString(),
    ...extra,
  });

  it('records a whole trip: start, detections sent twice, end, and read back', async () => {
    const token = await person('ana@example.com');

    const started = await start(token);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      model: { version: '1.0.0', minConfidence: 0.4 },
      limits: { maxGpsAccuracyM: 20, maxBatchSize: 100 },
    });
    const tripId = started.body.tripId as string;

    const batch = {
      detections: [
        seen(1, { bboxAreaRatio: 0.005 }),
        seen(2, { bboxAreaRatio: 0.02 }),
        seen(3, { bboxAreaRatio: 0.06 }),
        seen(4, { confidence: 0.1 }),
        seen(5, { gpsAccuracyM: 90 }),
      ],
    };
    const first = await call('POST', `/api/trips/${tripId}/detections`, token, batch);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ received: 5, stored: 3, duplicates: 0 });
    expect(first.body.rejected).toEqual([
      { id: seen(4).id, reason: 'low_confidence' },
      { id: seen(5).id, reason: 'gps_not_accurate' },
    ]);

    // The answer got lost, the phone sends the same batch again: nothing changes.
    const again = await call('POST', `/api/trips/${tripId}/detections`, token, batch);
    expect(again.body).toMatchObject({ received: 5, stored: 0, duplicates: 3 });
    expect(await db.detections.count()).toBe(3);

    const closed = await call('PATCH', `/api/trips/${tripId}`, token, {
      framesAnalyzed: 3600,
      distanceM: 1250.5,
    });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ framesAnalyzed: 3600, distanceM: 1250.5 });

    const read = await call('GET', `/api/trips/${tripId}`, token);
    expect(read.body.detections).toEqual({
      total: 3,
      bySeverity: [
        { severity: 'leve', count: 1 },
        { severity: 'moderado', count: 1 },
        { severity: 'grave', count: 1 },
      ],
    });

    // Detections still come in after the end (the queue of a phone without signal).
    const late = await call('POST', `/api/trips/${tripId}/detections`, token, {
      detections: [seen(6)],
    });
    expect(late.body).toMatchObject({ stored: 1 });
  });

  it('lists the trips of the person, newest first, page by page', async () => {
    const token = await person('ana@example.com');
    const ids: string[] = [];
    for (const minutesAgo of [30, 20, 10]) {
      const started = await start(token, {
        startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      });
      ids.push(started.body.tripId as string);
    }

    const first = await call('GET', '/api/trips?limit=2', token);
    const firstTrips = first.body.trips as { id: string }[];
    expect(firstTrips.map((trip) => trip.id)).toEqual([ids[2], ids[1]]);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await call(
      'GET',
      `/api/trips?limit=2&cursor=${encodeURIComponent(first.body.nextCursor as string)}`,
      token,
    );
    expect((second.body.trips as { id: string }[]).map((trip) => trip.id)).toEqual([ids[0]]);
    expect(second.body.nextCursor).toBeNull();

    expect((await call('GET', '/api/trips?cursor=made-up', token)).status).toBe(400);
  });

  it('keeps the trips of a person from anyone else', async () => {
    const ana = await person('ana@example.com');
    const luis = await person('luis@example.com');
    const tripId = (await start(ana)).body.tripId as string;

    for (const [method, path, body] of [
      ['GET', `/api/trips/${tripId}`, undefined],
      ['PATCH', `/api/trips/${tripId}`, { framesAnalyzed: 1, distanceM: 1 }],
      ['POST', `/api/trips/${tripId}/detections`, { detections: [seen(1)] }],
    ] as const) {
      const answer = await call(method, path, luis, body);
      expect(answer.status).toBe(404);
      expect(answer.body).toMatchObject({ error: { code: 'TRIP_NOT_FOUND' } });
    }
    expect(((await call('GET', '/api/trips', luis)).body.trips as unknown[]).length).toBe(0);
    expect(await db.detections.count()).toBe(0);
  });

  it('asks for a session and for the role', async () => {
    const plain = await person('visita@example.com', false);

    expect((await start('')).status).toBe(401);
    expect((await call('GET', '/api/trips')).status).toBe(401);
    expect((await start(plain)).status).toBe(403);
    expect((await call('GET', '/api/trips', plain)).status).toBe(403);
  });

  it('refuses a model that is not the active one', async () => {
    const token = await person('ana@example.com');

    const answer = await start(token, { modelVersion: '0.9.0' });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({
      error: { code: 'MODEL_VERSION_MISMATCH', details: { expected: '1.0.0', received: '0.9.0' } },
    });
  });

  it('reuses the device of a phone across trips', async () => {
    const token = await person('ana@example.com');

    const one = await start(token);
    const two = await start(token);

    expect(one.body.deviceId).toBe(two.body.deviceId);
    expect(await db.devices.count()).toBe(1);
  });
});
