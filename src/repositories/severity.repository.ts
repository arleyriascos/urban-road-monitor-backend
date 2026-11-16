import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SeverityLevel } from '../detections/severity.js';

/** Reads the severity_levels table, the single owner of the limits between severities. */
export class SeverityRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Every level, from the least to the most severe. */
  async findAll(): Promise<SeverityLevel[]> {
    const rows = await this.db.severity_levels.findMany({ orderBy: { min_area_ratio: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      minAreaRatio: Number(row.min_area_ratio),
      maxAreaRatio: Number(row.max_area_ratio),
    }));
  }
}

export const severityRepository = new SeverityRepository();
