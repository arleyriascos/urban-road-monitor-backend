-- =====================================================================
-- File 05: application role with limited privileges
-- Run ONCE per environment (Neon), connected as the database owner,
-- AFTER 00_run_all.sql. It is not part of 00_run_all.sql on purpose:
-- the password differs per environment and must never be committed.
--
-- Before running: replace CHANGE_ME_STRONG_PASSWORD with a long random
-- password (20+ characters, letters and numbers). Do NOT commit the
-- real password: undo the change before pushing this file to Git.
-- =====================================================================

CREATE ROLE app_user WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';

-- Allow connecting to the database and using the public schema,
-- but NOT creating, altering or dropping tables.
GRANT CONNECT ON DATABASE urban_road_monitor TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Read and write data in every table and view.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Users are deactivated, never deleted: the app cannot delete them.
REVOKE DELETE ON users FROM app_user;

-- Sequences behind SERIAL / BIGSERIAL ids.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Same privileges for tables and sequences created later by the owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;
