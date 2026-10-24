-- =====================================================================
-- File 06: adds the drawn shape (geometry) of each road segment
-- Without it, a curved street would be drawn as a straight line between
-- its two intersections. Intermediate points are stored here instead of
-- as graph nodes, so the graph keeps one node per intersection.
--
-- Run ONCE per environment (local, Neon development, Neon main),
-- connected as the database owner, after 00_run_all.sql.
-- =====================================================================

BEGIN;

ALTER TABLE road_segments ADD COLUMN geometry JSONB;

-- Segments that already exist get a straight line from start to end node.
UPDATE road_segments rs
SET geometry = jsonb_build_array(
        jsonb_build_array(fn.latitude, fn.longitude),
        jsonb_build_array(tn.latitude, tn.longitude)
    )
FROM road_nodes fn, road_nodes tn
WHERE fn.id = rs.from_node_id
  AND tn.id = rs.to_node_id;

ALTER TABLE road_segments ALTER COLUMN geometry SET NOT NULL;

-- A line needs at least two points.
ALTER TABLE road_segments ADD CONSTRAINT chk_road_segments_geometry
    CHECK (jsonb_typeof(geometry) = 'array' AND jsonb_array_length(geometry) >= 2);

COMMENT ON COLUMN road_segments.geometry IS
    'Shape of the segment: JSON array of [latitude, longitude] points from the start node to the end node.';

COMMIT;
