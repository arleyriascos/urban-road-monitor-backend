-- =====================================================================
-- Migration 10: base of the consolidation of Stage 4
--
-- Consolidation groups the detections of the phones into potholes (DBSCAN, in the
-- AI service) and keeps the potholes, their status and the damage of each segment
-- up to date. This migration prepares the tables for it:
--
--   1. clustering_runs also records how a run started (automatic or by an
--      administrator), how it ended (running, finished or failed), how many
--      clusters it found, how many potholes it removed and why it failed.
--   2. Only one run can be "running" at a time, whatever number of servers there are.
--   3. Two parameters: how many days of detections each run reads (90) and how many
--      seconds must pass between two automatic runs (120).
--   4. An index on detections.received_at, to know which detections arrived after
--      the last run.
--
-- Run ONCE per environment (local, test database, Neon development, Neon
-- production), connected as the database owner, after 00_run_all.sql and the
-- migrations 06 to 09. It is safe to run twice: the second run changes nothing.
-- Run it in Neon production BEFORE deploying the code that uses it.
-- =====================================================================

BEGIN;

-- 1. What a run records ---------------------------------------------------
ALTER TABLE clustering_runs
    ADD COLUMN IF NOT EXISTS status           VARCHAR(10) NOT NULL DEFAULT 'finished',
    ADD COLUMN IF NOT EXISTS trigger_kind     VARCHAR(10) NOT NULL DEFAULT 'automatic',
    ADD COLUMN IF NOT EXISTS requested_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS window_days      INT,
    ADD COLUMN IF NOT EXISTS clusters_found   INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS potholes_removed INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS error_code       VARCHAR(40),
    ADD COLUMN IF NOT EXISTS error_message    VARCHAR(300);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_clustering_status') THEN
        ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_status
            CHECK (status IN ('running', 'finished', 'failed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_clustering_trigger_kind') THEN
        ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_trigger_kind
            CHECK (trigger_kind IN ('automatic', 'manual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_clustering_extra_counters') THEN
        ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_extra_counters
            CHECK (clusters_found >= 0 AND potholes_removed >= 0
                   AND (window_days IS NULL OR window_days >= 1));
    END IF;
END $$;

-- 2. One run at a time ----------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_clustering_one_running
    ON clustering_runs ((TRUE)) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_clustering_runs_started ON clustering_runs (started_at DESC, id DESC);

-- 3. Parameters -----------------------------------------------------------
INSERT INTO system_parameters (key, value, description) VALUES
    ('clustering_window_days',
     '90',
     'Días hacia atrás de detecciones que lee cada consolidación.'),
    ('clustering_min_interval_s',
     '120',
     'Segundos mínimos entre dos consolidaciones automáticas.')
ON CONFLICT (key) DO NOTHING;

-- 4. Detections that arrived after the last run ---------------------------
CREATE INDEX IF NOT EXISTS idx_detections_received_at ON detections (received_at);

COMMIT;

-- Check: the new columns, the two parameters and the index.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'clustering_runs' ORDER BY ordinal_position;
SELECT key, value FROM system_parameters WHERE key LIKE 'clustering_%' ORDER BY key;
