export interface SeedGuardInput {
  /** NODE_ENV of the process. */
  nodeEnv: string;
  /** SEED_ALLOWED_HOST from the .env file: the only server where seeding is allowed. */
  allowedHost: string | undefined;
  /** Host of DATABASE_URL, with or without port. */
  targetHost: string;
  /** Detections already stored in the database. */
  detections: number;
}

const hostnameOf = (host: string): string => host.split(':')[0].trim().toLowerCase();

/**
 * The test potholes are invented data. They may only be written to a server that the
 * person declared on purpose, never in production, and never over real detections.
 */
export function assertSeedAllowed(input: SeedGuardInput): void {
  if (input.nodeEnv === 'production') {
    throw new Error('El script de baches de prueba no puede ejecutarse con NODE_ENV=production.');
  }

  if (!input.allowedHost || input.allowedHost.trim() === '') {
    throw new Error(
      'Falta SEED_ALLOWED_HOST en tu archivo .env. Agrega la línea ' +
        'SEED_ALLOWED_HOST=<servidor de la rama development> para declarar en qué servidor ' +
        'se permite crear baches de prueba. No se escribió nada.',
    );
  }

  if (hostnameOf(input.targetHost) !== hostnameOf(input.allowedHost)) {
    throw new Error(
      `El servidor de DATABASE_URL (${input.targetHost}) no es el servidor permitido ` +
        `(${input.allowedHost}). No se escribió nada.`,
    );
  }

  if (input.detections > 0) {
    throw new Error(
      `La base de datos ya tiene ${input.detections} detecciones reales; los baches de prueba ` +
        'solo se crean en bases sin detecciones. No se escribió nada.',
    );
  }
}
