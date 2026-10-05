-- =====================================================================
-- File 00: full script (01 + 02 + 03 + 04, in order)
-- In pgAdmin or the Neon SQL Editor, run it once while connected to
-- the urban_road_monitor database. Everything runs in one transaction:
-- if something fails, nothing is created.
-- =====================================================================

BEGIN;

-- =====================================================================
-- Project: Pothole Detection and Route Recommendation on Urban Roads
-- Database: urban_road_monitor (PostgreSQL 18)
-- File 01: creates the 25 tables
-- Run while connected to the urban_road_monitor database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- MODULE 1: AUTHENTICATION (8 tables)
-- ---------------------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(150) NOT NULL,
    avatar_url      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(80) NOT NULL UNIQUE,
    description     TEXT
);

CREATE TABLE user_roles (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         INT  NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
    role_id         INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE oauth_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(30)  NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_account_id)
);

CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL UNIQUE,
    ip_address          VARCHAR(45),
    user_agent          TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type      VARCHAR(30) NOT NULL,
    success         BOOLEAN NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- CATALOGS (created first because other tables depend on them)
-- ---------------------------------------------------------------------

CREATE TABLE severity_levels (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(30) NOT NULL UNIQUE,
    min_area_ratio  NUMERIC(6,4) NOT NULL,
    max_area_ratio  NUMERIC(6,4) NOT NULL,
    cost_weight     NUMERIC(6,2) NOT NULL,
    color_hex       VARCHAR(7)   NOT NULL
);

CREATE TABLE pothole_statuses (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(30) NOT NULL UNIQUE,
    description     TEXT
);

CREATE TABLE road_types (
    id              SERIAL PRIMARY KEY,
    osm_highway_tag VARCHAR(50)  NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL
);

CREATE TABLE ai_models (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    version         VARCHAR(30)  NOT NULL,
    framework       VARCHAR(50)  NOT NULL,
    input_size      INT          NOT NULL,
    min_confidence  NUMERIC(5,4) NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
    released_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (name, version)
);

-- ---------------------------------------------------------------------
-- MODULE 3: ROAD NETWORK (the graph)
-- ---------------------------------------------------------------------

CREATE TABLE roads (
    id              BIGSERIAL PRIMARY KEY,
    road_type_id    INT    NOT NULL REFERENCES road_types(id) ON DELETE RESTRICT,
    osm_way_id      BIGINT NOT NULL UNIQUE,
    name            VARCHAR(200),
    total_length_m  NUMERIC(12,2) NOT NULL DEFAULT 0,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE road_nodes (
    id              BIGSERIAL PRIMARY KEY,
    osm_node_id     BIGINT NOT NULL UNIQUE,
    latitude        NUMERIC(9,6) NOT NULL,
    longitude       NUMERIC(9,6) NOT NULL
);

CREATE TABLE road_segments (
    id                      BIGSERIAL PRIMARY KEY,
    road_id                 BIGINT NOT NULL REFERENCES roads(id) ON DELETE CASCADE,
    from_node_id            BIGINT NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    to_node_id              BIGINT NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    segment_index           INT    NOT NULL,
    length_m                NUMERIC(10,2) NOT NULL,
    is_oneway               BOOLEAN NOT NULL DEFAULT FALSE,
    damage_score            NUMERIC(10,4) NOT NULL DEFAULT 0,
    max_severity_level_id   INT REFERENCES severity_levels(id) ON DELETE SET NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (road_id, segment_index)
);

-- ---------------------------------------------------------------------
-- MODULE 2: DETECTION AND CONSOLIDATION
-- ---------------------------------------------------------------------

CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    label           VARCHAR(100),
    platform        VARCHAR(20) NOT NULL,
    browser         VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trips (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    ai_model_id     INT  NOT NULL REFERENCES ai_models(id) ON DELETE RESTRICT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    frames_analyzed INT NOT NULL DEFAULT 0,
    distance_m      NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE clustering_runs (
    id                      SERIAL PRIMARY KEY,
    eps_meters              NUMERIC(6,2) NOT NULL,
    min_points              INT NOT NULL,
    detections_processed    INT NOT NULL DEFAULT 0,
    potholes_created        INT NOT NULL DEFAULT 0,
    potholes_updated        INT NOT NULL DEFAULT 0,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at             TIMESTAMPTZ
);

CREATE TABLE potholes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    road_segment_id         BIGINT REFERENCES road_segments(id) ON DELETE SET NULL,
    severity_level_id       INT NOT NULL REFERENCES severity_levels(id) ON DELETE RESTRICT,
    status_id               INT NOT NULL REFERENCES pothole_statuses(id) ON DELETE RESTRICT,
    last_clustering_run_id  INT REFERENCES clustering_runs(id) ON DELETE SET NULL,
    latitude                NUMERIC(9,6) NOT NULL,
    longitude               NUMERIC(9,6) NOT NULL,
    confidence              NUMERIC(5,4) NOT NULL DEFAULT 0,
    detection_count         INT NOT NULL DEFAULT 1,
    first_detected_at       TIMESTAMPTZ NOT NULL,
    last_detected_at        TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE detections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id             UUID NOT NULL REFERENCES trips(id) ON DELETE RESTRICT,
    severity_level_id   INT  NOT NULL REFERENCES severity_levels(id) ON DELETE RESTRICT,
    pothole_id          UUID REFERENCES potholes(id) ON DELETE SET NULL,
    latitude            NUMERIC(9,6) NOT NULL,
    longitude           NUMERIC(9,6) NOT NULL,
    gps_accuracy_m      NUMERIC(6,2),
    model_confidence    NUMERIC(5,4) NOT NULL,
    bbox_area_ratio     NUMERIC(6,4) NOT NULL,
    detected_at         TIMESTAMPTZ NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pothole_status_history (
    id              BIGSERIAL PRIMARY KEY,
    pothole_id      UUID NOT NULL REFERENCES potholes(id) ON DELETE CASCADE,
    status_id       INT  NOT NULL REFERENCES pothole_statuses(id) ON DELETE RESTRICT,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    reason          VARCHAR(255),
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE repair_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pothole_id      UUID NOT NULL REFERENCES potholes(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    comment         TEXT,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- ROUTING AND CONFIGURATION
-- ---------------------------------------------------------------------

CREATE TABLE route_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    origin_node_id      BIGINT NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    destination_node_id BIGINT NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    algorithm           VARCHAR(20) NOT NULL DEFAULT 'astar',
    total_length_m      NUMERIC(12,2),
    total_cost          NUMERIC(14,4),
    computation_ms      INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE route_steps (
    route_request_id    UUID   NOT NULL REFERENCES route_requests(id) ON DELETE CASCADE,
    step_order          INT    NOT NULL,
    road_segment_id     BIGINT NOT NULL REFERENCES road_segments(id) ON DELETE RESTRICT,
    PRIMARY KEY (route_request_id, step_order)
);

CREATE TABLE system_parameters (
    key             VARCHAR(80) PRIMARY KEY,
    value           VARCHAR(255) NOT NULL,
    description     TEXT,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- DATA DICTIONARY (description of each table, visible in pgAdmin)
-- ---------------------------------------------------------------------

COMMENT ON TABLE users                  IS 'Users registered with a Google account. Never deleted: deactivated with is_active and deleted_at.';
COMMENT ON TABLE roles                  IS 'System roles: colaborador (contributor) and administrador (administrator).';
COMMENT ON TABLE permissions            IS 'Actions a role is allowed to perform.';
COMMENT ON TABLE user_roles             IS 'Many-to-many relation between users and roles.';
COMMENT ON TABLE role_permissions       IS 'Many-to-many relation between roles and permissions.';
COMMENT ON TABLE oauth_accounts         IS 'Link between a user and their Google account.';
COMMENT ON TABLE sessions               IS 'Active sessions and refresh token hash.';
COMMENT ON TABLE auth_logs              IS 'Audit log of sign-ins, sign-outs and failed attempts.';
COMMENT ON TABLE severity_levels        IS 'Severity catalog (leve, moderado, grave) with thresholds and route cost weight.';
COMMENT ON TABLE pothole_statuses       IS 'Pothole status catalog (sin confirmar, confirmado, reparado).';
COMMENT ON TABLE road_types             IS 'Road type catalog based on the OpenStreetMap highway tag.';
COMMENT ON TABLE ai_models              IS 'Versions of the vision model used to detect potholes.';
COMMENT ON TABLE roads                  IS 'Roads imported from OpenStreetMap.';
COMMENT ON TABLE road_nodes             IS 'Road network intersections: graph nodes.';
COMMENT ON TABLE road_segments          IS 'Segments between two nodes: graph edges with their damage weight. segment_index orders segments for the Segment Tree.';
COMMENT ON TABLE devices                IS 'Phones used by users to detect potholes.';
COMMENT ON TABLE trips                  IS 'Trips during which the camera was active.';
COMMENT ON TABLE clustering_runs        IS 'DBSCAN runs with their parameters and results.';
COMMENT ON TABLE potholes               IS 'Potholes consolidated by DBSCAN.';
COMMENT ON TABLE detections             IS 'Raw detections produced by the vision model.';
COMMENT ON TABLE pothole_status_history IS 'Status change history of each pothole (filled by a trigger).';
COMMENT ON TABLE repair_reports         IS 'Repair reports submitted by users.';
COMMENT ON TABLE route_requests         IS 'Requested routes and their result. user_id is NULL for guests.';
COMMENT ON TABLE route_steps            IS 'Segments that make up each route, in order.';
COMMENT ON TABLE system_parameters      IS 'Adjustable system parameters (DBSCAN, half-life, frames per second).';


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


-- =====================================================================
-- File 04: seed data (catalog values are in Spanish)
-- Requires files 01, 02 and 03
-- The road network is NOT loaded here: it is imported from OpenStreetMap
-- by a backend script. Users are created when they sign in with Google.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
INSERT INTO roles (name, description) VALUES
    ('colaborador',   'Usuario registrado que aporta detecciones y reporta baches reparados.'),
    ('administrador', 'Gestiona parámetros del sistema, modelos de IA y estados de los baches.');

-- ---------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('detections.create',      'Registrar detecciones de baches en el mapa.'),
    ('potholes.report_repair', 'Reportar un bache como reparado.'),
    ('potholes.update_status', 'Cambiar manualmente el estado de un bache.'),
    ('trips.view_own',         'Ver el historial de sus propios recorridos.'),
    ('routes.view_history',    'Ver el historial de rutas solicitadas.'),
    ('parameters.update',      'Modificar los parámetros del sistema.'),
    ('ai_models.manage',       'Registrar y activar versiones del modelo de visión.'),
    ('users.manage',           'Activar, desactivar y asignar roles a usuarios.'),
    ('clustering.run',         'Ejecutar manualmente la consolidación DBSCAN.');

-- Contributor (colaborador): basic permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('detections.create', 'potholes.report_repair',
                                 'trips.view_own', 'routes.view_history')
WHERE r.name = 'colaborador';

-- Administrator (administrador): all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'administrador';

-- ---------------------------------------------------------------------
-- Severity levels (bounding box area relative to the image)
-- ---------------------------------------------------------------------
INSERT INTO severity_levels (name, min_area_ratio, max_area_ratio, cost_weight, color_hex) VALUES
    ('leve',     0.0000, 0.0200, 0.50, '#FACC15'),
    ('moderado', 0.0200, 0.0600, 2.00, '#F97316'),
    ('grave',    0.0600, 1.0000, 6.00, '#DC2626');

-- ---------------------------------------------------------------------
-- Pothole statuses
-- ---------------------------------------------------------------------
INSERT INTO pothole_statuses (name, description) VALUES
    ('sin confirmar', 'Detectado una sola vez; aún no es confiable.'),
    ('confirmado',    'Detectado al menos dos veces; se muestra en el mapa y afecta las rutas.'),
    ('reparado',      'Reportado como reparado; deja de afectar las rutas salvo que se detecte de nuevo.');

-- ---------------------------------------------------------------------
-- Road types (OpenStreetMap highway tag)
-- ---------------------------------------------------------------------
INSERT INTO road_types (osm_highway_tag, name) VALUES
    ('trunk',         'Vía troncal'),
    ('primary',       'Vía principal'),
    ('secondary',     'Vía secundaria'),
    ('tertiary',      'Vía terciaria'),
    ('residential',   'Calle residencial'),
    ('living_street', 'Calle de tráfico calmado'),
    ('service',       'Vía de servicio'),
    ('unclassified',  'Vía sin clasificar');

-- ---------------------------------------------------------------------
-- Initial vision model (updated once the final model is trained)
-- ---------------------------------------------------------------------
INSERT INTO ai_models (name, version, framework, input_size, min_confidence, is_active) VALUES
    ('YOLOv8n Baches', '1.0.0', 'tensorflowjs', 320, 0.5000, TRUE);

-- ---------------------------------------------------------------------
-- System parameters
-- ---------------------------------------------------------------------
INSERT INTO system_parameters (key, value, description) VALUES
    ('dbscan_eps_meters',            '5',     'Distancia máxima en metros para considerar dos detecciones el mismo bache.'),
    ('dbscan_min_points',            '2',     'Detecciones mínimas para confirmar un bache.'),
    ('confidence_half_life_days',    '30',    'Días en que la confianza de un bache baja a la mitad si nadie lo vuelve a detectar.'),
    ('repair_report_factor',         '0.2',   'Factor por el que se multiplica la confianza al reportar un bache como reparado.'),
    ('frames_per_second',            '4',     'Imágenes por segundo que analiza el modelo en el celular.'),
    ('max_gps_accuracy_m',           '20',    'Precisión GPS máxima aceptada; detecciones menos precisas se descartan.'),
    ('default_route_algorithm',      'astar', 'Algoritmo de ruteo por defecto (astar o dijkstra).');

-- ---------------------------------------------------------------------
-- ASSIGN ADMINISTRATOR (run AFTER signing in with Google)
-- 1. Sign in to the app once so your user is created.
-- 2. Change the email, select only these lines and run them.
-- ---------------------------------------------------------------------
-- INSERT INTO user_roles (user_id, role_id)
-- SELECT u.id, r.id
-- FROM users u, roles r
-- WHERE u.email = 'your_email@gmail.com'
--   AND r.name  = 'administrador';


COMMIT;
