/** A trip that the cleanup looks at, with what hangs from it. */
export interface CleanupTrip {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  detectionCount: number;
  /** How many of its detections already form part of a pothole. */
  detectionsInPotholes: number;
}

/** What the cleanup would do: the trips that go, the ones that stay and why. */
export interface CleanupPlan {
  /** Trips without any detection in a pothole: safe to delete with everything they hold. */
  deletable: CleanupTrip[];
  /** Trips with detections already in a pothole: those data count for the map, so they stay. */
  blocked: CleanupTrip[];
  /** What deleting `deletable` removes. */
  totals: { trips: number; detections: number };
}

export function planCleanup(trips: readonly CleanupTrip[]): CleanupPlan {
  const deletable = trips.filter((trip) => trip.detectionsInPotholes === 0);
  const blocked = trips.filter((trip) => trip.detectionsInPotholes > 0);
  return {
    deletable,
    blocked,
    totals: {
      trips: deletable.length,
      detections: deletable.reduce((sum, trip) => sum + trip.detectionCount, 0),
    },
  };
}

/** A moment as people in Colombia read it: 2026-11-16 08:30 (UTC-5). */
export function colombiaTime(date: Date): string {
  return new Date(date.getTime() - 5 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

function line(trip: CleanupTrip): string {
  const end = trip.endedAt ? colombiaTime(trip.endedAt) : 'sin cerrar';
  return `  ${trip.id}  ${colombiaTime(trip.startedAt)} → ${end}  ${trip.detectionCount} detecciones`;
}

/** The text that says what would be deleted (or what was), for the person at the keyboard. */
export function formatCleanupPlan(email: string, plan: CleanupPlan): string {
  const parts: string[] = [];
  if (plan.deletable.length === 0 && plan.blocked.length === 0) {
    return `La cuenta ${email} no tiene viajes que coincidan.`;
  }
  if (plan.deletable.length > 0) {
    parts.push(
      `Se borrarían ${plan.totals.trips} viajes y ${plan.totals.detections} detecciones de ${email} (hora de Colombia):`,
      ...plan.deletable.map(line),
    );
  }
  if (plan.blocked.length > 0) {
    parts.push(
      `${plan.deletable.length > 0 ? '\n' : ''}No se tocan (tienen detecciones que ya forman parte de un bache):`,
      ...plan.blocked.map((trip) => `${line(trip)}, ${trip.detectionsInPotholes} en baches`),
    );
  }
  return parts.join('\n');
}
