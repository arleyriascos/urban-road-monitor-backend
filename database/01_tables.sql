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
