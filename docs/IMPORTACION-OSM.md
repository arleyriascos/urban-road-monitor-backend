# Importación de la red vial de Pasto

El comando `npm run import:roads` descarga las calles del casco urbano de Pasto desde OpenStreetMap y las guarda en la base de datos como un grafo: **nodos** (intersecciones y extremos de calle), **vías** y **tramos** entre intersecciones. Cada tramo guarda su trazado en `road_segments.geometry`, para dibujar bien las calles curvas.

## Qué importa y qué descarta

- Solo los 8 tipos de vía del catálogo `road_types`: `trunk`, `primary`, `secondary`, `tertiary`, `residential`, `living_street`, `service` y `unclassified`.
- Descarta las vías cerradas a carros y motos (`access`, `vehicle` o `motor_vehicle` en `no` o `private`). Si una etiqueta más específica la abre (por ejemplo `motor_vehicle=yes`), se importa.
- Respeta el sentido de las calles con `is_oneway`. Las glorietas siempre son de un solo sentido. Las calles con `oneway=-1` se guardan invertidas, de modo que el tránsito siempre va del nodo inicial al final.
- Una vía que cruza el borde del rectángulo se importa completa.

## Antes de empezar

1. Tu archivo `.env` debe apuntar a la rama **development** de Neon, con el usuario `app_user`.
2. Las migraciones 06 y 07 de `database/` deben estar ejecutadas en esa rama.
3. Ejecuta `npm ci` si es la primera vez en este computador.

## Paso 1: prueba sin escribir nada

```powershell
npm run import:roads -- --dry-run
```

Descarga los datos de OpenStreetMap (puede tardar un par de minutos), los guarda en `data/osm/` y muestra un resumen. **No escribe nada en la base de datos.**

Cómo leer el resumen:

- **Vías que se importarán**: si dice 0 o muy pocas, el rectángulo o la descarga falló.
- Si son cientos de miles de tramos, el rectángulo es demasiado grande.
- **Descartadas por acceso**: son vías privadas; es normal que haya algunas.
- **Descartados (sin longitud o en bucle)**: debe ser un número muy pequeño.

## Paso 2: importar de verdad

```powershell
npm run import:roads
```

Usa los datos ya descargados, sin volver a pedirlos. Antes de escribir, muestra el servidor y la base de datos de destino y pide confirmación:

```
Vas a ESCRIBIR en esta base de datos:
  Servidor: ep-ejemplo-123456.us-east-1.aws.neon.tech
  Base:     urban_road_monitor
Escribe "si" para continuar (otra cosa cancela):
```

Compara el servidor con el de la rama **development** en Neon (botón **Connect**). Si coincide, escribe `si`. Si no coincide, escribe otra cosa: no se guarda nada.

## Paso 3: verificar en pgAdmin

Conéctate a la rama development, abre el Query Tool en `urban_road_monitor` y ejecuta:

```sql
SELECT
  (SELECT COUNT(*) FROM roads)         AS vias,
  (SELECT COUNT(*) FROM road_nodes)    AS nodos,
  (SELECT COUNT(*) FROM road_segments) AS tramos;

SELECT is_oneway, COUNT(*) FROM road_segments GROUP BY is_oneway;

SELECT road_name, length_m, jsonb_array_length(geometry) AS puntos
FROM v_segment_status
ORDER BY puntos DESC
LIMIT 5;
```

Las cantidades deben coincidir con el resumen del importador.

## Repetir la importación

Se puede ejecutar todas las veces que haga falta:

- No duplica: actualiza lo que ya existe y agrega lo nuevo.
- No toca `damage_score` ni `max_severity_level_id`, así que los baches ya registrados siguen afectando los tramos.
- Si una vía ahora tiene menos tramos que antes, elimina los sobrantes, **excepto** los que tienen baches o forman parte de una ruta guardada.
- No borra vías que ya no aparezcan en OpenStreetMap.
- Todo ocurre en una sola transacción: si algo falla, no se guarda nada a medias.

## Opciones

| Opción           | Qué hace                                                          |
| ---------------- | ----------------------------------------------------------------- |
| `--dry-run`      | Descarga y cuenta, pero no escribe en la base de datos            |
| `--refresh`      | Descarga de nuevo aunque ya haya datos guardados en el computador |
| `--bbox S,O,N,E` | Cambia el rectángulo: sur,oeste,norte,este                        |
| `--help`         | Muestra la ayuda                                                  |

Ejemplo con otro rectángulo:

```powershell
npm run import:roads -- --dry-run --bbox 1.19,-77.31,1.24,-77.25
```

Para obtener coordenadas, haz clic derecho sobre el mapa en Google Maps o en openstreetmap.org y copia la latitud y la longitud. Cada rectángulo distinto se guarda en su propio archivo.

## Si algo falla

| Mensaje                                                                | Qué hacer                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `No se pudo descargar la información de OpenStreetMap tras 4 intentos` | Los servidores públicos de Overpass están ocupados. Espera unos 5 minutos y repite |
| `El archivo ... está dañado`                                           | Ejecuta de nuevo con `--refresh`                                                   |
| `Faltan tipos de vía en el catálogo road_types`                        | Ejecuta los scripts de `database/` en esa base de datos                            |
| `Authentication failed ... app_user`                                   | Revisa la contraseña en `DATABASE_URL` dentro de `.env`                            |
| `No se encontraron vías para importar`                                 | El rectángulo no tiene calles de esos tipos; revisa `--bbox`                       |

## Archivos descargados

Los datos se guardan en `data/osm/`, una carpeta que Git ignora. Pueden pesar varios megabytes y se pueden borrar sin problema: se vuelven a descargar cuando hagan falta.
