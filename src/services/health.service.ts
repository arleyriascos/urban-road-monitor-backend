import { AppError } from '../errors/app-error.js';
import { healthRepository, type HealthRepository } from '../repositories/health.repository.js';

export interface DatabaseStatus {
  status: 'connected' | 'disconnected';
  latencyMs: number | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  database: DatabaseStatus;
  timestamp: string;
}

export interface HelloMessage {
  message: string;
  project: string;
  database: {
    status: 'connected';
    name: string;
    serverTime: string;
    latencyMs: number;
    severityLevels: string[];
  };
  timestamp: string;
}

/** Business logic for the health check and the "Hello World" endpoint. */
export class HealthService {
  constructor(private readonly repository: HealthRepository = healthRepository) {}

  async getHealth(): Promise<HealthReport> {
    const startedAt = performance.now();
    let database: DatabaseStatus;

    try {
      await this.repository.ping();
      database = { status: 'connected', latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      console.error('Database health check failed:', error);
      database = { status: 'disconnected', latencyMs: null };
    }

    return {
      status: database.status === 'connected' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      database,
      timestamp: new Date().toISOString(),
    };
  }

  async getHello(): Promise<HelloMessage> {
    const startedAt = performance.now();

    try {
      const snapshot = await this.repository.getSnapshot();

      return {
        message: 'Hello World',
        project: 'Urban Road Monitor',
        database: {
          status: 'connected',
          name: snapshot.databaseName,
          serverTime: snapshot.serverTime.toISOString(),
          latencyMs: Math.round(performance.now() - startedAt),
          severityLevels: snapshot.severityLevels,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Could not read from the database:', error);
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not available right now');
    }
  }
}

export const healthService = new HealthService();
