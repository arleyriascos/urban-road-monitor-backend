-- =====================================================================
-- Migration 13: one-use links sent by e-mail (verify the email, choose a new password)
--
-- Both flows work the same way: the server makes a random token, e-mails a link that
-- carries it, and keeps only its SHA-256 here. The token is never stored, so whoever reads
-- this table cannot use it. A token expires, and it works once.
--
--   purpose = 'verify_email'    proves the email is the person's (users.email_verified_at)
--   purpose = 'reset_password'  lets the person choose a new password without the old one
--
-- Run ONCE per environment (local, test database, Neon development, Neon production),
-- connected as the database owner, after the migrations 06 to 12. It is safe to run twice:
-- the second run changes nothing. Run it in Neon production BEFORE deploying the code
-- that uses it.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS email_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20) NOT NULL,
    token_hash  CHAR(64) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_email_tokens_purpose
        CHECK (purpose IN ('verify_email', 'reset_password')),
    CONSTRAINT chk_email_tokens_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT uq_email_tokens_hash UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user_purpose
    ON email_tokens (user_id, purpose)
    WHERE used_at IS NULL;

COMMENT ON TABLE email_tokens IS
    'One-use links sent by e-mail. It stores only the SHA-256 of each token, never the token.';
COMMENT ON COLUMN email_tokens.used_at IS
    'When the token was used, or replaced by a newer one of the same purpose. Null while it can still work.';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON email_tokens TO app_user;
    END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------
-- CHECK (run after COMMIT; the result must show true)
-- ---------------------------------------------------------------------
SELECT 'email_tokens table' AS item,
       EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_name = 'email_tokens')::text AS ok;
