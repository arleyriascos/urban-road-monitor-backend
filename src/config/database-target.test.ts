import { describe, expect, it } from 'vitest';
import { describeDatabaseTarget } from './database-target.js';

describe('describeDatabaseTarget', () => {
  it('returns the host and the database name', () => {
    expect(
      describeDatabaseTarget('postgresql://app_user:secret@ep-dev-1.neon.tech/urban_road_monitor'),
    ).toEqual({ host: 'ep-dev-1.neon.tech', database: 'urban_road_monitor' });
  });

  it('keeps the port when there is one', () => {
    expect(describeDatabaseTarget('postgresql://u:p@localhost:5432/db').host).toBe(
      'localhost:5432',
    );
  });

  it('never includes the user or the password', () => {
    const target = describeDatabaseTarget('postgresql://app_user:very-secret@host.example/db');
    expect(JSON.stringify(target)).not.toContain('very-secret');
    expect(JSON.stringify(target)).not.toContain('app_user');
  });

  it('ignores the query string', () => {
    expect(describeDatabaseTarget('postgres://u:p@host.example/db?sslmode=require').database).toBe(
      'db',
    );
  });
});
