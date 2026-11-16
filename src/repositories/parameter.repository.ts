import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** Reads the system_parameters table, where the administrator keeps the settings. */
export class ParameterRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * The number stored under a key. If the key does not exist, or its text is not a finite
   * number, the fallback is used: a bad value in the table must not stop the service.
   */
  async getNumber(key: string, fallback: number): Promise<number> {
    const row = await this.db.system_parameters.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row) {
      return fallback;
    }
    const value = Number(row.value);
    return row.value.trim() !== '' && Number.isFinite(value) ? value : fallback;
  }
}

export const parameterRepository = new ParameterRepository();
