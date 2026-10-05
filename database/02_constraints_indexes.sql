-- =====================================================================
-- File 02: validation constraints (CHECK) and indexes
-- Requires 01_tables.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- VALIDATIONS: the database rejects impossible data
-- ---------------------------------------------------------------------

-- Authentication
ALTER TABLE users ADD CONSTRAINT chk_users_email_format
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
ALTER TABLE users ADD CONSTRAINT chk_users_deleted_inactive
    CHECK (deleted_at IS NULL OR is_active = FALSE);
ALTER TABLE oauth_accounts ADD CONSTRAINT chk_oauth_provider
    CHECK (provider IN ('google'));
ALTER TABLE sessions ADD CONSTRAINT chk_sessions_expiration
    CHECK (expires_at > created_at);
ALTER TABLE auth_logs ADD CONSTRAINT chk_auth_logs_event_type
    CHECK (event_type IN ('login', 'logout', 'login_failed', 'token_refresh'));

-- Catalogs
ALTER TABLE severity_levels ADD CONSTRAINT chk_severity_area_range
    CHECK (min_area_ratio >= 0 AND max_area_ratio <= 1 AND min_area_ratio < max_area_ratio);
ALTER TABLE severity_levels ADD CONSTRAINT chk_severity_cost_weight
    CHECK (cost_weight >= 0);
ALTER TABLE severity_levels ADD CONSTRAINT chk_severity_color_hex
    CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE ai_models ADD CONSTRAINT chk_ai_models_input_size
    CHECK (input_size > 0);
ALTER TABLE ai_models ADD CONSTRAINT chk_ai_models_min_confidence
    CHECK (min_confidence BETWEEN 0 AND 1);

-- Road network
ALTER TABLE roads ADD CONSTRAINT chk_roads_total_length
    CHECK (total_length_m >= 0);
ALTER TABLE road_nodes ADD CONSTRAINT chk_road_nodes_coordinates
    CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE road_segments ADD CONSTRAINT chk_road_segments_distinct_nodes
    CHECK (from_node_id <> to_node_id);
ALTER TABLE road_segments ADD CONSTRAINT chk_road_segments_length
    CHECK (length_m > 0);
ALTER TABLE road_segments ADD CONSTRAINT chk_road_segments_index
    CHECK (segment_index >= 0);
ALTER TABLE road_segments ADD CONSTRAINT chk_road_segments_damage
    CHECK (damage_score >= 0);

-- Detection and consolidation
ALTER TABLE devices ADD CONSTRAINT chk_devices_platform
    CHECK (platform IN ('android', 'ios', 'other'));
ALTER TABLE trips ADD CONSTRAINT chk_trips_dates
    CHECK (ended_at IS NULL OR ended_at >= started_at);
ALTER TABLE trips ADD CONSTRAINT chk_trips_counters
    CHECK (frames_analyzed >= 0 AND distance_m >= 0);
ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_parameters
    CHECK (eps_meters > 0 AND min_points >= 1);
ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_counters
    CHECK (detections_processed >= 0 AND potholes_created >= 0 AND potholes_updated >= 0);
ALTER TABLE clustering_runs ADD CONSTRAINT chk_clustering_dates
    CHECK (finished_at IS NULL OR finished_at >= started_at);
ALTER TABLE potholes ADD CONSTRAINT chk_potholes_coordinates
    CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE potholes ADD CONSTRAINT chk_potholes_confidence
    CHECK (confidence BETWEEN 0 AND 1);
ALTER TABLE potholes ADD CONSTRAINT chk_potholes_detection_count
    CHECK (detection_count >= 1);
ALTER TABLE potholes ADD CONSTRAINT chk_potholes_dates
    CHECK (last_detected_at >= first_detected_at);
ALTER TABLE detections ADD CONSTRAINT chk_detections_coordinates
    CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE detections ADD CONSTRAINT chk_detections_gps_accuracy
    CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m >= 0);
ALTER TABLE detections ADD CONSTRAINT chk_detections_model_confidence
    CHECK (model_confidence BETWEEN 0 AND 1);
ALTER TABLE detections ADD CONSTRAINT chk_detections_bbox_area
    CHECK (bbox_area_ratio > 0 AND bbox_area_ratio <= 1);

-- Routing
ALTER TABLE route_requests ADD CONSTRAINT chk_route_requests_algorithm
    CHECK (algorithm IN ('astar', 'dijkstra'));
ALTER TABLE route_requests ADD CONSTRAINT chk_route_requests_distinct_nodes
    CHECK (origin_node_id <> destination_node_id);
ALTER TABLE route_requests ADD CONSTRAINT chk_route_requests_cost
    CHECK (total_cost IS NULL OR total_length_m IS NULL OR total_cost >= total_length_m);
ALTER TABLE route_requests ADD CONSTRAINT chk_route_requests_computation
    CHECK (computation_ms IS NULL OR computation_ms >= 0);
ALTER TABLE route_steps ADD CONSTRAINT chk_route_steps_order
    CHECK (step_order >= 1);

-- ---------------------------------------------------------------------
-- INDEXES: speed up the most frequent queries
-- (PostgreSQL already creates indexes for PRIMARY KEY and UNIQUE)
-- ---------------------------------------------------------------------

-- Authentication
CREATE INDEX idx_user_roles_role          ON user_roles (role_id);
CREATE INDEX idx_role_permissions_perm    ON role_permissions (permission_id);
CREATE INDEX idx_oauth_accounts_user      ON oauth_accounts (user_id);
CREATE INDEX idx_sessions_user            ON sessions (user_id);
CREATE INDEX idx_sessions_expires         ON sessions (expires_at);
CREATE INDEX idx_auth_logs_user           ON auth_logs (user_id);
CREATE INDEX idx_auth_logs_created        ON auth_logs (created_at);

-- Road network
CREATE INDEX idx_roads_type               ON roads (road_type_id);
CREATE INDEX idx_road_nodes_coordinates   ON road_nodes (latitude, longitude);
CREATE INDEX idx_road_segments_from       ON road_segments (from_node_id);
CREATE INDEX idx_road_segments_to         ON road_segments (to_node_id);
CREATE INDEX idx_road_segments_severity   ON road_segments (max_severity_level_id);

-- Detection and consolidation
CREATE INDEX idx_devices_user             ON devices (user_id);
CREATE INDEX idx_trips_user               ON trips (user_id);
CREATE INDEX idx_trips_device             ON trips (device_id);
CREATE INDEX idx_trips_model              ON trips (ai_model_id);
CREATE INDEX idx_detections_trip          ON detections (trip_id);
CREATE INDEX idx_detections_severity      ON detections (severity_level_id);
CREATE INDEX idx_detections_pothole       ON detections (pothole_id);
CREATE INDEX idx_detections_detected_at   ON detections (detected_at);
CREATE INDEX idx_detections_coordinates   ON detections (latitude, longitude);
CREATE INDEX idx_detections_unclustered   ON detections (detected_at) WHERE pothole_id IS NULL;
CREATE INDEX idx_potholes_segment         ON potholes (road_segment_id);
CREATE INDEX idx_potholes_severity        ON potholes (severity_level_id);
CREATE INDEX idx_potholes_status          ON potholes (status_id);
CREATE INDEX idx_potholes_run             ON potholes (last_clustering_run_id);
CREATE INDEX idx_potholes_coordinates     ON potholes (latitude, longitude);
CREATE INDEX idx_status_history_pothole   ON pothole_status_history (pothole_id);
CREATE INDEX idx_status_history_status    ON pothole_status_history (status_id);
CREATE INDEX idx_status_history_user      ON pothole_status_history (changed_by);
CREATE INDEX idx_repair_reports_pothole   ON repair_reports (pothole_id);
CREATE INDEX idx_repair_reports_user      ON repair_reports (user_id);

-- Routing and configuration
CREATE INDEX idx_route_requests_user      ON route_requests (user_id);
CREATE INDEX idx_route_requests_origin    ON route_requests (origin_node_id);
CREATE INDEX idx_route_requests_dest      ON route_requests (destination_node_id);
CREATE INDEX idx_route_requests_created   ON route_requests (created_at);
CREATE INDEX idx_route_steps_segment      ON route_steps (road_segment_id);
CREATE INDEX idx_system_parameters_user   ON system_parameters (updated_by);
