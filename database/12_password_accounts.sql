-- =====================================================================
-- Migration 12: accounts with an email and a password of their own
--
-- Until now the only way in was Google. This migration prepares the tables for the
-- second way, an email and a password:
--
--   1. password_credentials: one row per account that has a password. It holds the
--      hash of the password (never the password) in a self-describing text:
--      "scrypt$N$r$p$salt$hash". An account that only uses Google has no row.
--   2. users.email_verified_at: when the person proved the email is theirs. Google
--      proves it at every sign-in, so the accounts that already exist are filled in
--      here. An account made with a password stays empty until the email is verified
--      (the verification itself comes with the e-mail service).
--
-- Run ONCE per environment (local, test database, Neon development, Neon
-- production), connected as the database owner, after the migrations 06 to 11. It is
-- safe to run twice: the second run changes nothing. Run it in Neon production BEFORE
-- deploying the code that uses it.
-- =====================================================================

BEGIN;

-- 1. Password hashes ---------------------------------------------------
CREATE TABLE IF NOT EXISTS password_credentials (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_password_credentials_format
        CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$')
);

COMMENT ON TABLE password_credentials IS
    'The password of the accounts that have one. It stores only the scrypt hash, never the password.';
COMMENT ON COLUMN password_credentials.password_hash IS
    'scrypt$N$r$p$salt$hash, with the salt and the hash in base64url. The parameters travel with the hash so they can change later.';

DROP TRIGGER IF EXISTS trg_password_credentials_updated_at ON password_credentials;
CREATE TRIGGER trg_password_credentials_updated_at
    BEFORE UPDATE ON password_credentials
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. Verified email -----------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN users.email_verified_at IS
    'When the person proved the email is theirs (Google does it at every sign-in). Null until then.';

-- The accounts that already exist were all made with Google, which verifies the email.
UPDATE users u
SET email_verified_at = u.created_at
WHERE u.email_verified_at IS NULL
  AND EXISTS (SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id);

-- 3. The application user can use the new table -------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON password_credentials TO app_user;
    END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------
-- CHECK (run after COMMIT; the result must show true in both rows, and the
-- third row must be 0: no account with Google is left without a verified email)
-- ---------------------------------------------------------------------
SELECT 'password_credentials table' AS item,
       EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'password_credentials')::text AS ok
UNION ALL
SELECT 'users.email_verified_at',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'users' AND column_name = 'email_verified_at')::text
UNION ALL
SELECT 'google accounts without a verified email',
       (SELECT count(*) FROM users u
        WHERE u.email_verified_at IS NULL
          AND EXISTS (SELECT 1 FROM oauth_accounts o WHERE o.user_id = u.id))::text;
