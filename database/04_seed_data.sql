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
