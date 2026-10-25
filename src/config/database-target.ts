/** Where a DATABASE_URL points to, without the user and the password. */
export interface TargetDescription {
  host: string;
  database: string;
}

export function describeDatabaseTarget(databaseUrl: string): TargetDescription {
  const url = new URL(databaseUrl);
  return {
    host: url.port ? `${url.hostname}:${url.port}` : url.hostname,
    database: url.pathname.replace(/^\//, ''),
  };
}
