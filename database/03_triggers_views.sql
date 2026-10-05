-- =====================================================================
-- File 03: functions, triggers and views
-- Requires 01_tables.sql and 02_constraints_indexes.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- TRIGGER 1: set updated_at automatically on every UPDATE
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_potholes_updated_at
    BEFORE UPDATE ON potholes
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_road_segments_updated_at
    BEFORE UPDATE ON road_segments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_system_parameters_updated_at
    BEFORE UPDATE ON system_parameters
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------
-- TRIGGER 2: log every status change in pothole_status_history
-- When a user makes the change, the backend runs first:
--     SET LOCAL app.current_user_id = '<user uuid>';
-- Otherwise changed_by stays NULL (system change, e.g. DBSCAN).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_log_pothole_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_reason  VARCHAR(255);
BEGIN
    v_user_id := NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;

    IF TG_OP = 'INSERT' THEN
        v_reason := 'Bache registrado por consolidación DBSCAN';
    ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
        v_reason := CASE WHEN v_user_id IS NULL
                         THEN 'Cambio automático del sistema'
                         ELSE 'Cambio realizado por un usuario' END;
    ELSE
        RETURN NEW;  -- status did not change: nothing to log
    END IF;

    INSERT INTO pothole_status_history (pothole_id, status_id, changed_by, reason)
    VALUES (NEW.id, NEW.status_id, v_user_id, v_reason);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_potholes_status_history
    AFTER INSERT OR UPDATE OF status_id ON potholes
    FOR EACH ROW EXECUTE FUNCTION fn_log_pothole_status_change();

-- ---------------------------------------------------------------------
-- VIEW 1: status of each segment, used to color the map
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_segment_status AS
SELECT
    rs.id                       AS segment_id,
    r.id                        AS road_id,
    r.name                      AS road_name,
    rt.name                     AS road_type,
    rs.segment_index,
    rs.length_m,
    rs.is_oneway,
    fn.latitude                 AS from_latitude,
    fn.longitude                AS from_longitude,
    tn.latitude                 AS to_latitude,
    tn.longitude                AS to_longitude,
    rs.damage_score,
    rs.length_m * (1 + rs.damage_score) AS route_cost,
    COALESCE(sl.name, 'sin baches')     AS max_severity,
    COALESCE(sl.color_hex, '#22C55E')   AS color_hex,
    COUNT(p.id)                 AS active_potholes,
    rs.updated_at
FROM road_segments rs
JOIN roads r            ON r.id  = rs.road_id
JOIN road_types rt      ON rt.id = r.road_type_id
JOIN road_nodes fn      ON fn.id = rs.from_node_id
JOIN road_nodes tn      ON tn.id = rs.to_node_id
LEFT JOIN severity_levels sl ON sl.id = rs.max_severity_level_id
LEFT JOIN potholes p
       ON p.road_segment_id = rs.id
      AND p.status_id IN (SELECT id FROM pothole_statuses WHERE name <> 'reparado')
GROUP BY rs.id, r.id, r.name, rt.name, fn.latitude, fn.longitude,
         tn.latitude, tn.longitude, sl.name, sl.color_hex;

COMMENT ON VIEW v_segment_status IS 'Status of each segment with its color, route cost and active potholes.';

-- ---------------------------------------------------------------------
-- VIEW 2: pothole summary with severity, status and location
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_pothole_summary AS
SELECT
    p.id                        AS pothole_id,
    p.latitude,
    p.longitude,
    sl.name                     AS severity,
    sl.color_hex,
    ps.name                     AS status,
    p.confidence,
    p.detection_count,
    r.name                      AS road_name,
    rs.segment_index,
    p.first_detected_at,
    p.last_detected_at,
    EXTRACT(DAY FROM NOW() - p.last_detected_at)::INT AS days_since_last_detection,
    (SELECT COUNT(*) FROM repair_reports rr WHERE rr.pothole_id = p.id) AS repair_reports_count
FROM potholes p
JOIN severity_levels sl       ON sl.id = p.severity_level_id
JOIN pothole_statuses ps      ON ps.id = p.status_id
LEFT JOIN road_segments rs    ON rs.id = p.road_segment_id
LEFT JOIN roads r             ON r.id  = rs.road_id;

COMMENT ON VIEW v_pothole_summary IS 'Summary of each pothole with severity, status, road and repair reports.';
