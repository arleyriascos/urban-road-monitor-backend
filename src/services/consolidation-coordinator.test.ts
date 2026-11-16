import { describe, expect, it, vi } from 'vitest';
import {
  BATCH_DELAY_MS,
  ConsolidationCoordinator,
  RETRY_PAUSES_MS,
  STARTUP_DELAY_MS,
  type CoordinatorDependencies,
} from './consolidation-coordinator.js';
import type { RunOutcome } from './consolidation.service.js';

const FINISHED: RunOutcome = {
  kind: 'finished',
  runId: 1,
  segmentsChanged: 0,
  stats: {
    detectionsProcessed: 1,
    clustersFound: 1,
    potholesCreated: 1,
    potholesUpdated: 0,
    potholesRemoved: 0,
  },
};
const FAILED: RunOutcome = {
  kind: 'failed',
  runId: 2,
  code: 'AI_HIBERNATING',
  message: 'asleep',
};

/** A clock and a timer that only move when the test says so. */
function setup(outcomes: RunOutcome[] = [FINISHED], change: Partial<CoordinatorDependencies> = {}) {
  let now = 1_000_000;
  const timers: { at: number; action: () => void; cancelled: boolean }[] = [];
  const queue = [...outcomes];
  const run = vi.fn(async () => queue.shift() ?? FINISHED);
  const runs = {
    findLastFinishedStart: vi.fn(async () => null as Date | null),
    countDetectionsReceivedAfter: vi.fn(async () => 0),
  };
  const coordinator = new ConsolidationCoordinator({
    service: { run, isConfigured: true },
    parameters: { getNumber: async (_key: string, fallback: number) => fallback },
    runs,
    clock: () => now,
    schedule: (action, delayMs) => {
      const timer = { at: now + delayMs, action, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    },
    ...change,
  });
  const live = () => timers.filter((timer) => !timer.cancelled);
  /** Moves the clock to the next planned timer and fires it, then lets the run finish. */
  async function fireNext(): Promise<number> {
    const timer = live()[0];
    if (!timer) throw new Error('nothing planned');
    timer.cancelled = true;
    now = Math.max(now, timer.at);
    timer.action();
    await vi.waitFor(() => expect(coordinator['running']).toBe(false));
    await Promise.resolve();
    return now;
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    coordinator,
    run,
    runs,
    live,
    fireNext,
    flush,
    advance: (ms: number) => (now += ms),
    clock: () => now,
  };
}

describe('ConsolidationCoordinator', () => {
  it('plans a run a few seconds after detections are stored, and one run covers many notices', async () => {
    const { coordinator, run, live, fireNext, flush } = setup();
    coordinator.notify();
    coordinator.notify();
    coordinator.notify();
    await flush();

    expect(live()).toHaveLength(1);
    expect(live()[0]!.at - 1_000_000).toBe(BATCH_DELAY_MS);

    await fireNext();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('automatic', null);
    expect(live()).toHaveLength(0);
  });

  it('waits two minutes after the last run began before the next one', async () => {
    const { coordinator, live, fireNext, flush, clock } = setup();
    coordinator.notify();
    await flush();
    const firstStart = await fireNext();

    coordinator.notify();
    await flush();
    expect(live()[0]!.at).toBe(firstStart + 120_000);
    expect(clock()).toBe(firstStart);
  });

  it('asks for another run when detections arrive while one is going on', async () => {
    let release: (outcome: RunOutcome) => void = () => undefined;
    const slow = new Promise<RunOutcome>((resolve) => (release = resolve));
    const { coordinator, live, flush, run } = setup([], {
      service: { run: vi.fn(() => slow), isConfigured: true },
    });
    void run;
    coordinator.notify();
    await flush();
    live()[0]!.action();
    await flush();

    coordinator.notify(); // arrives during the run
    await flush();
    expect(live().length).toBe(1); // only the one that already fired: nothing new is planned yet

    release(FINISHED);
    await vi.waitFor(() => expect(live().length).toBeGreaterThan(1));
  });

  it('does not plan anything when nothing new arrived', async () => {
    const { coordinator, live, fireNext, flush } = setup();
    coordinator.notify();
    await flush();
    await fireNext();
    await flush();
    expect(live()).toHaveLength(0);
  });

  it('tries again after 5, 10, 20 and 30 minutes when runs keep failing, then recovers', async () => {
    const { coordinator, live, fireNext, flush, clock } = setup([
      FAILED,
      FAILED,
      FAILED,
      FAILED,
      FAILED,
      FINISHED,
    ]);
    coordinator.notify();
    await flush();

    const waits: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const started = await fireNext();
      await flush();
      expect(live()).toHaveLength(1);
      waits.push(live()[0]!.at - started);
      expect(clock()).toBe(started);
    }
    expect(waits.map((ms) => Math.max(ms, 0))).toEqual(
      [...RETRY_PAUSES_MS, RETRY_PAUSES_MS.at(-1)!].map((pause) => expect.closeTo(pause, -3)),
    );

    await fireNext();
    await flush();
    expect(live()).toHaveLength(0);
    expect((await coordinator.status()).failuresInARow).toBe(0);
  });

  it('never plans a run when the AI service is not configured', async () => {
    const { coordinator, live, flush } = setup([FINISHED], {
      service: { run: vi.fn(), isConfigured: false },
    });
    coordinator.notify();
    await flush();
    expect(live()).toHaveLength(0);
    expect(coordinator.requestManual('admin')).toBe('not_configured');
  });

  describe('start', () => {
    it('plans a run for detections nobody grouped, after a pause', async () => {
      const { coordinator, runs, live, clock } = setup();
      runs.countDetectionsReceivedAfter.mockResolvedValueOnce(12);
      await coordinator.start();
      expect(live()).toHaveLength(1);
      expect(live()[0]!.at - clock()).toBe(STARTUP_DELAY_MS);
    });

    it('plans nothing when every detection was grouped', async () => {
      const { coordinator, live } = setup();
      await coordinator.start();
      expect(live()).toHaveLength(0);
    });

    it('does not fail the server when the database does not answer', async () => {
      const { coordinator, runs } = setup();
      runs.findLastFinishedStart.mockRejectedValueOnce(new Error('down'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(coordinator.start()).resolves.toBeUndefined();
    });
  });

  describe('requestManual', () => {
    it('starts a run at once, as manual, and cancels the planned one', async () => {
      const { coordinator, run, live, flush } = setup();
      coordinator.notify();
      await flush();
      expect(live()).toHaveLength(1);

      expect(coordinator.requestManual('admin-1')).toBe('started');
      await flush();

      expect(run).toHaveBeenCalledWith('manual', 'admin-1');
      expect(live()).toHaveLength(0);
    });

    it('says busy while a run is going on', async () => {
      let release: (outcome: RunOutcome) => void = () => undefined;
      const slow = new Promise<RunOutcome>((resolve) => (release = resolve));
      const { coordinator } = setup([], {
        service: { run: vi.fn(() => slow), isConfigured: true },
      });
      expect(coordinator.requestManual('a')).toBe('started');
      expect(coordinator.requestManual('b')).toBe('busy');
      release(FINISHED);
      await coordinator.stop();
    });
  });

  it('reports its state', async () => {
    const { coordinator, runs, flush } = setup();
    runs.countDetectionsReceivedAfter.mockResolvedValue(4);
    coordinator.notify();
    await flush();
    const status = await coordinator.status();
    expect(status).toMatchObject({ running: false, failuresInARow: 0, pendingDetections: 4 });
    expect(status.nextRunAt).toBeInstanceOf(Date);
  });

  it('stops planning after stop()', async () => {
    const { coordinator, live, flush } = setup();
    coordinator.notify();
    await flush();
    await coordinator.stop();
    expect(live()).toHaveLength(0);
    coordinator.notify();
    await flush();
    expect(live()).toHaveLength(0);
  });
});
