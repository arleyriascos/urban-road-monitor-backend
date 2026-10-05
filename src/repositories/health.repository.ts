import { prisma } from '../config/database.js';

export interface DatabaseSnapshot {
  databaseName: string;
  serverTime: Date;
  severityLevels: string[];
}

/**
 * Repository pattern: this class is the only place that knows HOW the data is read.
 * Services ask for data without knowing about SQL or Prisma.
 */
export class HealthRepository {
  /** Lightest possible query, used to check that the database answers. */
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }

  /** Reads real data to prove the connection works end to end. */
  async getSnapshot(): Promise<DatabaseSnapshot> {
    const [info] = await prisma.$queryRaw<{ database_name: string; server_time: Date }[]>`
      SELECT current_database() AS database_name, NOW() AS server_time
    `;

    const severityLevels = await prisma.severity_levels.findMany({
      select: { name: true },
      orderBy: { id: 'asc' },
    });

    return {
      databaseName: info.database_name,
      serverTime: info.server_time,
      severityLevels: severityLevels.map((level) => level.name),
    };
  }
}

export const healthRepository = new HealthRepository();
