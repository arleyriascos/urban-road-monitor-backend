-- =====================================================================
-- File 07: adds the segment geometry to the v_segment_status view
-- The map reads this view, so it needs the shape of each segment.
-- The new column is appended at the end, which CREATE OR REPLACE VIEW allows.
--
-- Run ONCE per environment (local, Neon development, Neon main),
-- connected as the database owner, after 06_add_segment_geometry.sql.
-- =====================================================================

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
    rs.updated_at,
    rs.geometry
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

COMMENT ON VIEW v_segment_status IS 'Status of each segment with its color, route cost, active potholes and geometry.';
