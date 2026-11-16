-- =====================================================================
-- Migration 11: every account can record detections
--
-- Until now only the role "colaborador" had the permissions to record detections
-- (detections.create) and to see its own trips (trips.view_own). Anyone who signed in
-- with Google was a "usuario" and saw the camera but saved nothing until an
-- administrator gave them the role. The project now wants the opposite: whoever signs
-- in (a classmate, the professor) can save the potholes the camera finds.
--
-- This migration gives those two permissions to the role "usuario", which every account
-- has. The role "colaborador" keeps working and still adds potholes.report_repair and
-- routes.view_history. A guest (no account) still cannot save: there is no one to
-- record the trip for.
--
-- Run ONCE per environment (local, test database, Neon development, Neon
-- production), connected as the database owner, after the migrations 06 to 10. It is
-- safe to run twice: the second run changes nothing. It also reaches the accounts that
-- already exist, because the permissions belong to the role, not to each account.
-- Run it in Neon production at any time: the code does not need it to start; the
-- accounts just gain the permission once it has run.
-- =====================================================================

BEGIN;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('detections.create', 'trips.view_own')
WHERE r.name = 'usuario'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- Check (it must list the two permissions):
--   SELECT p.code FROM role_permissions rp
--   JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
--   WHERE r.name = 'usuario' ORDER BY p.code;
