-- =====================================================================
-- Migration 09: base of the trips and detections of Stage 4
--
--   1. Severity limits: leve under 1 %, moderado from 1 % to 4 %, grave from 4 %
--      of the picture. They are the limits the camera screen already draws with;
--      the server now classifies every detection with this table, so there is
--      only one rule. They will be tuned after the street tests.
--   2. The active vision model is the one the phone really runs: ONNX, 416 px,
--      confidence threshold 0.40 (the first seed said tensorflowjs, 320 px, 0.50).
--   3. An index to list the trips of a person, newest first.
--
-- Run ONCE per environment (local, test database, Neon development, Neon
-- production), connected as the database owner, after 00_run_all.sql and the
-- migrations 06, 07 and 08. It is safe to run twice: the second run changes
-- nothing. Run it in Neon production BEFORE deploying the code that uses it.
-- =====================================================================

BEGIN;

-- 1. Severity limits ---------------------------------------------------
UPDATE severity_levels SET min_area_ratio = 0.0000, max_area_ratio = 0.0100 WHERE name = 'leve';
UPDATE severity_levels SET min_area_ratio = 0.0100, max_area_ratio = 0.0400 WHERE name = 'moderado';
UPDATE severity_levels SET min_area_ratio = 0.0400, max_area_ratio = 1.0000 WHERE name = 'grave';

-- 2. The active vision model --------------------------------------------
INSERT INTO ai_models (name, version, framework, input_size, min_confidence, is_active)
VALUES ('YOLOv8n Baches', '1.0.0', 'onnxruntime-web', 416, 0.4000, TRUE)
ON CONFLICT (name, version) DO UPDATE
    SET framework = EXCLUDED.framework,
        input_size = EXCLUDED.input_size,
        min_confidence = EXCLUDED.min_confidence,
        is_active = TRUE;

-- Only one model is active at a time.
UPDATE ai_models SET is_active = FALSE
WHERE is_active AND NOT (name = 'YOLOv8n Baches' AND version = '1.0.0');

-- 3. Trips of a person, newest first ----------------------------------------
CREATE INDEX IF NOT EXISTS idx_trips_user_started ON trips (user_id, started_at DESC, id DESC);

COMMIT;

-- Check: three severity levels with the new limits and one active model.
SELECT name, min_area_ratio, max_area_ratio FROM severity_levels ORDER BY min_area_ratio;
SELECT name, version, framework, input_size, min_confidence, is_active FROM ai_models;
