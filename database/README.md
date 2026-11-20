# urban-road-monitor-database

Base de datos del proyecto **Detección de Baches y Rutas en Vías Urbanas** (PostgreSQL 18).

## Contenido

| Archivo | Qué hace |
| --- | --- |
| `00_run_all.sql` | Script completo (01 a 04) en una sola transacción. Es el que se ejecuta en pgAdmin |
| `01_tables.sql` | Crea las 25 tablas y su descripción (diccionario de datos) |
| `02_constraints_indexes.sql` | Validaciones (CHECK) e índices |
| `03_triggers_views.sql` | Triggers (`updated_at` e historial de estados) y vistas (`v_segment_status`, `v_pothole_summary`) |
| `04_seed_data.sql` | Catálogos en español: roles, permisos, severidades, estados, tipos de vía, modelo y parámetros |
| `er-diagram.png` / `er-diagram.svg` | Diagrama entidad-relación completo |
| `05_app_user.sql` | Crea el usuario `app_user` con el que se conecta el backend: puede leer y escribir datos, pero no modificar la estructura ni borrar usuarios. Se ejecuta aparte, una vez por entorno |
| `06_add_segment_geometry.sql` | Migración: agrega a `road_segments` la columna `geometry` con el trazado de cada tramo, para dibujar bien las calles curvas |
| `07_add_geometry_to_segment_status_view.sql` | Migración: agrega `geometry` a la vista `v_segment_status`, que es la que lee el mapa |
| `08_auth_base.sql` | Migración: base de las sesiones y los roles de la Etapa 3 (ver más abajo) |
| `09_detections_base.sql` | Migración: base de los viajes y las detecciones de la Etapa 4 (ver más abajo) |
| `10_consolidation_base.sql` | Migración: base de la consolidación de baches de la Etapa 4 (ver más abajo) |
| `11_usuario_can_record.sql` | Migración: el rol `usuario` (toda cuenta) puede guardar detecciones y ver sus viajes; llega a las cuentas que ya existen. Idempotente |
| `12_password_accounts.sql` | Migración: base de las cuentas con correo y contraseña propias (ver más abajo) |

## Cómo ejecutarlo

1. En pgAdmin, crear la base de datos `urban_road_monitor` (vacía).
2. Seleccionarla y abrir **Tools → Query Tool**.
3. Abrir `00_run_all.sql` con el ícono de carpeta y ejecutar con **F5**.
4. Si aparece un error, todo se deshace automáticamente; la base queda vacía y se puede volver a intentar.

Si se modifica un archivo 01 a 04, hay que regenerar `00_run_all.sql` para que incluya el cambio.

## Usuario de la aplicación

Después de `00_run_all.sql`, abrir `05_app_user.sql`, reemplazar `CHANGE_ME_STRONG_PASSWORD` por una contraseña larga y ejecutarlo. **Nunca subir a Git el archivo con la contraseña real**: deshacer el cambio antes de hacer commit.

## Migraciones

Los cambios posteriores a la estructura inicial se agregan como archivos numerados (06, 07, ...),
sin modificar los scripts 01 a 04. Cada migración se ejecuta **una sola vez por entorno** (base
local, rama `development` y rama `production` de Neon), conectado como dueño de la base (`postgres` en
local, `urban_road_monitor_owner` en Neon), y en orden. Si se ejecuta dos veces, PostgreSQL la rechaza sin
dañar nada.

| Migración | Qué cambia |
| --- | --- |
| 06 | `road_segments.geometry` (JSONB): lista de puntos `[latitud, longitud]` desde el nodo inicial hasta el final. Así una calle curva se dibuja con su forma real, mientras el grafo conserva un solo nodo por intersección |
| 07 | La vista `v_segment_status` incluye `geometry` al final |
| 08 | `sessions.refresh_token_hash` pasa a `token_hash` (guarda el SHA-256 del identificador de sesión). Nuevo rol `usuario`, sin permisos propios. `auth_logs` suma la columna `reason` y más tipos de evento. Los correos se guardan en minúsculas (`chk_users_email_lowercase`). Se puede ejecutar dos veces sin dañar nada y termina con una consulta de verificación |
| 09 | Límites de gravedad: leve por debajo del 1 % de la foto, moderado de 1 % a 4 % y grave desde 4 %, los mismos que ya dibuja la pantalla de la cámara. El modelo activo pasa a ser el que corre en el celular: ONNX, 416 px y umbral de confianza 0.40. Nuevo índice para listar los viajes de una persona. Se puede ejecutar dos veces sin dañar nada y termina con dos consultas de verificación. En Neon `production` se ejecuta **antes** de desplegar el código que la usa |
| 10 | La consolidación (agrupar las detecciones en baches) deja registro de cada corrida: `clustering_runs` suma `status` (`running`, `finished` o `failed`), `trigger_kind` (`automatic` o `manual`), quién la pidió, los días leídos, los grupos hallados, los baches quitados y el error si falló. Un índice único parcial (`uq_clustering_one_running`) impide que haya dos corridas a la vez, aunque haya varios servidores. Dos parámetros nuevos: `clustering_window_days` (90, los días de detecciones que lee cada corrida) y `clustering_min_interval_s` (120, la pausa mínima entre dos corridas automáticas). Índice en `detections.received_at`. Se puede ejecutar dos veces sin dañar nada. En Neon `production` se ejecuta **antes** de desplegar el código que la usa |
| 11 | El rol `usuario` recibe los permisos `detections.create` y `trips.view_own`, así que toda cuenta que ingresa puede guardar detecciones y ver sus viajes; llega también a las cuentas que ya existen. Se puede ejecutar dos veces |
| 12 | Nueva tabla `password_credentials` (una fila por cuenta que tiene contraseña: guarda solo el hash scrypt, con sus parámetros, nunca la contraseña) y nueva columna `users.email_verified_at` (cuándo la persona demostró que el correo es suyo; las cuentas de Google que ya existen se llenan con su fecha de creación). Se puede ejecutar dos veces sin dañar nada y termina con una consulta de verificación. En Neon `production` se ejecuta **antes** de desplegar el código que la usa |

## Volver a crear desde cero

Clic derecho sobre `urban_road_monitor` → **Delete**, crearla de nuevo vacía y ejecutar, en orden:
`00_run_all.sql`, `05_app_user.sql` y las migraciones `06`, `07`, `08`, `09`, `10`, etc.

## Convenciones

- Código, comentarios, tablas y columnas en inglés; datos y documentación en español.
- Tablas en plural y `snake_case`.
- Fechas en `TIMESTAMPTZ` (se guardan en UTC y se muestran en hora de Colombia).
- Los usuarios no se borran: se desactivan con `is_active = false` y `deleted_at`.
