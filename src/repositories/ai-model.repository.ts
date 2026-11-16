import { prisma } from '../config/database.js';
import type { PrismaClient } from '../generated/prisma/client.js';

/** The vision model the phones run, as the ai_models table describes it. */
export interface ActiveModel {
  id: number;
  name: string;
  version: string;
  /** The confidence threshold of the model: a detection below it is not worth storing. */
  minConfidence: number;
}

/** Reads the ai_models table. */
export class AiModelRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** The model marked as active, or null if none is. The newest one wins if several are. */
  async findActive(): Promise<ActiveModel | null> {
    const row = await this.db.ai_models.findFirst({
      where: { is_active: true },
      orderBy: [{ released_at: 'desc' }, { id: 'desc' }],
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      minConfidence: Number(row.min_confidence),
    };
  }
}

export const aiModelRepository = new AiModelRepository();
