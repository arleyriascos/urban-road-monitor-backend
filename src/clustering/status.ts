import type { FoundCluster } from './ai-contract.js';

export type PotholeStatusName = 'sin confirmar' | 'confirmado' | 'reparado';

/** What the consolidation knows about a pothole that already exists. */
export interface ExistingPothole {
  id: string;
  latitude: number;
  longitude: number;
  statusName: string;
  /** When it was last marked as repaired; null if never, or if it is not known. */
  repairedAt: Date | null;
  /** Its segment, so the damage of that segment can be worked out again if it goes away. */
  segmentId: number | null;
}

/**
 * The status a pothole gets after a run.
 *
 * - A cluster seen at least twice is "confirmado", and one seen once is "sin confirmar".
 * - A repaired pothole stays "reparado", because someone said it was fixed and that is worth
 *   more than the old detections. It is "reopened" only by a detection newer than the repair:
 *   the same place was seen with the pothole again. If the day of the repair is not known,
 *   it stays repaired.
 */
export function decideStatus(
  cluster: Pick<FoundCluster, 'confirmed' | 'lastDetectedAt'>,
  existing: Pick<ExistingPothole, 'statusName' | 'repairedAt'> | undefined,
): PotholeStatusName {
  if (existing?.statusName === 'reparado') {
    const reopened =
      existing.repairedAt !== null &&
      cluster.lastDetectedAt.getTime() > existing.repairedAt.getTime();
    if (!reopened) {
      return 'reparado';
    }
  }
  return cluster.confirmed ? 'confirmado' : 'sin confirmar';
}
