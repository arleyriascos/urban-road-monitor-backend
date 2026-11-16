# Viajes y detecciones (Etapa 4, paquete 4)

Este documento explica cómo el teléfono le entrega al backend los baches que ve la cámara: abre un **viaje**, manda **lotes de detecciones** mientras maneja, y cierra el viaje. Es la parte del backend que usará el frontend (Kevin) en el paquete 6, y la que alimentará a la IA en el paquete 5.

## El recorrido

1. La persona entra con Google y recibe un `token` (ver `docs/AUTENTICACION.md`). Para grabar necesita el permiso `detections.create` (rol `colaborador`); para ver sus viajes, `trips.view_own`.
2. **Empieza el viaje:** `POST /api/trips` con el teléfono y la versión del modelo. El backend contesta con el `tripId` y con **las reglas** con que se juzgarán las detecciones (confianza mínima, precisión GPS máxima, tamaño del lote).
3. **Manda detecciones** en lotes: `POST /api/trips/:tripId/detections`, hasta 100 por lote.
4. **Cierra el viaje:** `PATCH /api/trips/:id` con los cuadros analizados y la distancia.
5. Después puede ver sus viajes con `GET /api/trips` y `GET /api/trips/:id`.

Todas las rutas piden `Authorization: Bearer <token>` y responden con `Cache-Control: no-store`.

## Empezar un viaje

`POST /api/trips`

```json
{
  "device": { "platform": "android", "browser": "Chrome 142", "label": "Pixel 7" },
  "modelVersion": "1.0.0",
  "startedAt": "2026-11-16T08:30:00-05:00"
}
```

- `platform` es `android`, `ios` u `other`. `browser` y `label` son opcionales (hasta 100 caracteres).
- `modelVersion` debe ser **la del modelo activo**. Si no, responde **409** `MODEL_VERSION_MISMATCH` con `details: { expected, received }`: el teléfono debe actualizar sus archivos del modelo.
- `startedAt` es opcional. Se le cree si no está en el futuro (más de 2 minutos) ni tiene más de 2 días; si no, se usa la hora del servidor.
- El teléfono se reconoce solo: la misma persona con el mismo teléfono, navegador y nombre usa el mismo dispositivo en cada viaje. Una persona guarda hasta 20 dispositivos; al pasarse, se reutiliza el que lleva más tiempo sin verse.

Responde **201**:

```json
{
  "tripId": "…uuid…",
  "deviceId": "…uuid…",
  "startedAt": "2026-11-16T13:30:00.000Z",
  "model": { "version": "1.0.0", "minConfidence": 0.4 },
  "limits": { "maxGpsAccuracyM": 20, "maxBatchSize": 100 }
}
```

El teléfono **debe usar** `minConfidence` y `maxGpsAccuracyM` para no mandar lo que el servidor va a rechazar. Vienen de la tabla de parámetros y del modelo activo, así que se pueden cambiar sin tocar el código.

## Mandar detecciones

`POST /api/trips/:tripId/detections`

```json
{
  "detections": [
    {
      "id": "…uuid hecho en el teléfono…",
      "latitude": 1.2136,
      "longitude": -77.2811,
      "gpsAccuracyM": 6.5,
      "confidence": 0.82,
      "bboxAreaRatio": 0.02,
      "detectedAt": "2026-11-16T08:41:12-05:00"
    }
  ]
}
```

- **De 1 a 100 detecciones por lote**, sin `id` repetidos, y sin campos de más (un campo que no está en la lista da 400). El cuerpo no puede pasar de 100 KB.
- **El teléfono no manda la severidad.** La calcula el servidor con la parte de la imagen que cubre la caja (`bboxAreaRatio`) y la tabla `severity_levels`: menos de 1 % es `leve`, de 1 % a menos de 4 % es `moderado`, y desde 4 % es `grave`. Los mismos límites que usa la cámara.
- Los valores se guardan redondeados a la precisión de la tabla (coordenadas a 6 decimales, confianza y área a 4).

### Qué contesta

```json
{
  "received": 5,
  "stored": 3,
  "duplicates": 0,
  "rejected": [
    { "id": "…", "reason": "low_confidence" },
    { "id": "…", "reason": "gps_not_accurate" }
  ]
}
```

Una detección mala **no es un error de la petición**: se guardan las buenas, y las otras vuelven en `rejected` con su motivo.

| Motivo             | Qué pasó                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| `in_the_future`    | Su hora va más de 2 minutos adelante del servidor                          |
| `too_old`          | Tiene más de 14 días                                                       |
| `before_trip`      | Es anterior al inicio del viaje (con 2 minutos de tolerancia)              |
| `gps_not_accurate` | Su error de GPS supera `maxGpsAccuracyM`. Si el teléfono no lo manda, pasa |
| `low_confidence`   | Su confianza es menor que `minConfidence` del modelo                       |

Un teléfono que recibe un `rejected` **descarta** esa detección: mandarla otra vez da la misma respuesta.

### Reintentar es seguro

El teléfono pone el `id` de cada detección. Si se pierde la respuesta (mala señal, la página se cerró), manda **el mismo lote otra vez**: lo que ya estaba guardado cuenta como `duplicates` y **no se toca**, aunque el reintento diga otra cosa. Así la Cola del navegador puede reintentar sin miedo a duplicar.

### Detecciones tardías

El viaje acepta detecciones mientras está abierto y **hasta 24 horas después de cerrado**: es el tiempo que puede necesitar la Cola de un teléfono sin señal. Pasado ese plazo responde **409** `TRIP_CLOSED`.

## Cerrar el viaje

`PATCH /api/trips/:id`

```json
{ "framesAnalyzed": 3600, "distanceM": 1250.5, "endedAt": "2026-11-16T09:05:00-05:00" }
```

- `framesAnalyzed` (entero de 0 a 1.000.000) y `distanceM` (0 a 1.000.000 m) son obligatorios. `endedAt` es opcional y se le cree si cae entre el inicio y ahora; si no, se usa ahora.
- Se puede mandar **dos veces**: el viaje ya cerrado se contesta tal como quedó la primera vez, sin cambiar sus números.
- Responde el viaje: `id`, `startedAt`, `endedAt`, `framesAnalyzed`, `distanceM` y `detections: { total, bySeverity: [{ severity, count }] }` (siempre aparecen las tres severidades, aunque sea con 0).

## Ver los viajes

- `GET /api/trips?limit=20&cursor=…` lista los viajes **de la persona**, del más nuevo al más viejo, con sus detecciones contadas. `limit` va de 1 a 50 (20 por defecto). Si hay más, la respuesta trae `nextCursor`; se pasa como `cursor` para pedir la página siguiente, y es `null` en la última. Un `cursor` inventado da **400** `INVALID_CURSOR`.
- `GET /api/trips/:id` da un viaje con sus detecciones por severidad.

El viaje de otra persona y un viaje que no existe responden igual, **404** `TRIP_NOT_FOUND`: nadie puede averiguar qué identificadores existen.

## Errores

| Código | `code`                                    | Cuándo                                                                   |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| 400    | `INVALID_REQUEST`, `INVALID_CURSOR`       | El cuerpo, la consulta o el cursor no son válidos                        |
| 401    | `UNAUTHORIZED`                            | No hay sesión que sirva                                                  |
| 403    | `FORBIDDEN`                               | Hay sesión, pero sin el permiso (`detections.create` o `trips.view_own`) |
| 404    | `TRIP_NOT_FOUND`                          | El viaje no es de esa persona o no existe                                |
| 409    | `MODEL_VERSION_MISMATCH`, `TRIP_CLOSED`   | El modelo del teléfono no es el activo; el viaje cerró hace más de 24 h  |
| 429    | `TOO_MANY_REQUESTS`                       | Más de 20 peticiones de viajes o 60 lotes por minuto y dirección IP      |
| 503    | `NO_ACTIVE_MODEL`, `DATABASE_UNAVAILABLE` | No hay modelo activo o la base no responde: reintentar más tarde         |

Un 503 **nunca** significa que la sesión murió: el teléfono conserva su sesión y su Cola, y reintenta.

## La geometría para la IA

`GET /internal/graph` (solo para el servicio de IA) ahora entrega, en cada tramo, su `geometry`: los puntos `[latitud, longitud]` con que se dibuja la calle de un extremo al otro. Así la IA ubica una detección sobre la curva real y no solo sobre la línea recta entre los dos nodos. La `version` del grafo **ahora sí cambia** si solo cambia la forma de un tramo.

## Migración 09

`database/09_detections_base.sql` (idempotente) hace tres cosas, y **debe correrse en cada base antes de desplegar este código**:

1. Alinea la tabla de severidades con la cámara: `leve` < 1 %, `moderado` de 1 % a < 4 %, `grave` ≥ 4 %.
2. Deja una sola fila de modelo activo (`YOLOv8n Baches`, versión `1.0.0`, confianza mínima 0,40).
3. Crea el índice `idx_trips_user_started` que usa la lista de viajes.

## Limpiar los viajes de prueba

Después de probar en la calle, `npm run trips:cleanup` borra los viajes de una cuenta con sus detecciones. **Sin `--aplicar` solo muestra** lo que borraría:

```
npm run trips:cleanup -- ana@example.com --desde 2026-11-16
npm run trips:cleanup -- ana@example.com --desde 2026-11-16 --aplicar
```

- `--desde AAAA-MM-DD` cuenta el día desde las 00:00 de Colombia.
- Con `--aplicar` dice a qué base apunta y pide escribir `SI`; cualquier otra cosa cancela.
- **No toca** un viaje si alguna de sus detecciones ya forma parte de un bache (esos datos ya cuentan para el mapa). Esa comprobación se repite dentro de la transacción de borrado.
- No borra la cuenta ni sus dispositivos.
