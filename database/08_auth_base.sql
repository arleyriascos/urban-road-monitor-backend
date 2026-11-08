-- =====================================================================
-- File 08: base for sessions and roles (Stage 3, block 1)
--   1. sessions.refresh_token_hash becomes token_hash: it holds the SHA-256
--      of the opaque session identifier (there is no refresh token).
--   2. New role "usuario": the base role of every new account. It has no
--      permissions of its own; "colaborador" is granted by hand.
--   3. auth_logs gets a "reason" column and more event types.
--   4. Emails are stored in lowercase: the database now enforces it.
--
-- Run ONCE per environment (local, test database, Neon development, Neon
-- production), connected as the database owner, after 00_run_all.sql and
-- the migrations 06 and 07. It is safe to run twice: the second run changes
-- nothing. Run it in Neon production BEFORE deploying the code that uses it.
-- =====================================================================

BEGIN;

-- 1. Session identifier hash ------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sessions'
          AND column_name = 'refresh_token_hash'
    ) THEN
        ALTER TABLE sessions RENAME COLUMN refresh_token_hash TO token_hash;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.sessions'::regclass
          AND conname = 'sessions_refresh_token_hash_key'
    ) THEN
        ALTER TABLE sessions RENAME CONSTRAINT sessions_refresh_token_hash_key
            TO sessions_token_hash_key;
    END IF;
END
$$;

COMMENT ON TABLE sessions IS
    'Open sessions. token_hash is the SHA-256 (hex) of the opaque session identifier, which is never stored.';
COMMENT ON COLUMN sessions.token_hash IS
    'SHA-256 of the session identifier, in hexadecimal (64 characters).';

-- 2. Base role ----------------------------------------------------------
INSERT INTO roles (name, description) VALUES
    ('usuario', 'Cuenta registrada sin permisos de escritura. Un administrador la promueve a colaborador.')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE roles IS
    'System roles: usuario (base), colaborador (contributor) and administrador (administrator).';

-- 3. Audit log ----------------------------------------------------------
ALTER TABLE auth_logs ADD COLUMN IF NOT EXISTS reason VARCHAR(40);
COMMENT ON COLUMN auth_logs.reason IS
    'Why an attempt failed or a session was rejected (for example expired, revoked, user_inactive). Never holds tokens or emails.';

ALTER TABLE auth_logs DROP CONSTRAINT IF EXISTS chk_auth_logs_event_type;
ALTER TABLE auth_logs ADD CONSTRAINT chk_auth_logs_event_type
    CHECK (event_type IN (
        'login', 'logout', 'login_failed', 'token_refresh', 'session_rejected',
        'role_changed', 'register', 'email_verified', 'password_changed',
        'password_reset', 'account_linked', 'account_deleted'
    ));

-- 4. Emails in lowercase ------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_email_lowercase;
ALTER TABLE users ADD CONSTRAINT chk_users_email_lowercase
    CHECK (email = lower(email));

COMMIT;

-- ---------------------------------------------------------------------
-- CHECK (run after COMMIT; the result must show:
--   sessions columns: token_hash present, refresh_token_hash absent
--   roles: colaborador, administrador, usuario
--   auth_logs has the reason column
--   2 constraints: chk_auth_logs_event_type and chk_users_email_lowercase)
-- ---------------------------------------------------------------------
SELECT 'sessions.token_hash' AS item,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'sessions' AND column_name = 'token_hash')::text AS ok
UNION ALL
SELECT 'sessions.refresh_token_hash gone',
       (NOT EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'sessions' AND column_name = 'refresh_token_hash'))::text
UNION ALL
SELECT 'roles', string_agg(name, ', ' ORDER BY id) FROM roles
UNION ALL
SELECT 'auth_logs.reason',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'auth_logs' AND column_name = 'reason')::text
UNION ALL
SELECT 'constraints', string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint
WHERE conname IN ('chk_auth_logs_event_type', 'chk_users_email_lowercase');
