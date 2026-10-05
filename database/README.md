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

## Cómo ejecutarlo

1. En pgAdmin, crear la base de datos `urban_road_monitor` (vacía).
2. Seleccionarla y abrir **Tools → Query Tool**.
3. Abrir `00_run_all.sql` con el ícono de carpeta y ejecutar con **F5**.
4. Si aparece un error, todo se deshace automáticamente; la base queda vacía y se puede volver a intentar.

Si se modifica un archivo 01 a 04, hay que regenerar `00_run_all.sql` para que incluya el cambio.

## Usuario de la aplicación

Después de `00_run_all.sql`, abrir `05_app_user.sql`, reemplazar `CHANGE_ME_STRONG_PASSWORD` por una contraseña larga y ejecutarlo. **Nunca subir a Git el archivo con la contraseña real**: deshacer el cambio antes de hacer commit.

## Volver a crear desde cero

Clic derecho sobre `urban_road_monitor` → **Delete**, crearla de nuevo vacía y ejecutar `00_run_all.sql`.

## Convenciones

- Código, comentarios, tablas y columnas en inglés; datos y documentación en español.
- Tablas en plural y `snake_case`.
- Fechas en `TIMESTAMPTZ` (se guardan en UTC y se muestran en hora de Colombia).
- Los usuarios no se borran: se desactivan con `is_active = false` y `deleted_at`.
