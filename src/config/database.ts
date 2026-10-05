import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

/**
 * Singleton pattern: the whole application shares ONE PrismaClient,
 * and therefore one connection pool to PostgreSQL.
 * Creating a client per request would quickly exhaust Neon's connections.
 */
class Database {
  private static instance: PrismaClient | undefined;

  // Private constructor: nobody can do `new Database()`.
  private constructor() {}

  static getClient(): PrismaClient {
    if (!Database.instance) {
      const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
      Database.instance = new PrismaClient({ adapter });
    }
    return Database.instance;
  }

  static async disconnect(): Promise<void> {
    if (Database.instance) {
      await Database.instance.$disconnect();
      Database.instance = undefined;
    }
  }
}

export const prisma = Database.getClient();
export const disconnectDatabase = () => Database.disconnect();
