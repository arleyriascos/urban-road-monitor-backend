# urban-road-monitor-backend

API REST del proyecto **Detección de Baches y Rutas en Vías Urbanas** (Pasto, Nariño).
Proyecto final de Estructuras de Datos — Kevin Basante y Arley Riascos.

El backend es la única capa que se comunica con la base de datos y con el servicio de IA.
El frontend solo conoce la URL de esta API.

## Tecnologías

- Node.js 24 + TypeScript
- Express 5
- PostgreSQL 18 (Neon)

## Requisitos

- Node.js 24 (ver `.nvmrc`)
- Git

## Instalación

```bash
git clone https://github.com/<usuario>/urban-road-monitor-backend.git
cd urban-road-monitor-backend
npm install
```

## Variables de entorno

1. Copia `.env.example` y renómbralo a `.env`.
2. Completa `DATABASE_URL` con la cadena de conexión del usuario `app_user` de la rama `development` de Neon.

El archivo `.env` está en `.gitignore` y **nunca** se sube a GitHub. Si falta una variable o tiene un formato inválido, el servidor no arranca y muestra cuál es el problema.

| Variable               | Descripción                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development`, `production` o `test`                                                                                                            |
| `PORT`                 | Puerto del servidor (por defecto 3000)                                                                                                          |
| `DATABASE_URL`         | Conexión a PostgreSQL en Neon con el usuario `app_user`                                                                                         |
| `CORS_ORIGIN`          | Orígenes del frontend permitidos, separados por comas                                                                                           |
| `INTERNAL_TOKEN`       | Opcional. Token compartido con el servicio de IA (mínimo 32 caracteres); vacío apaga `/internal/*`                                              |
| `AI_SERVICE_URL`       | Opcional. Dirección del servicio de IA que calcula las rutas; en producción debe empezar por `https://`                                         |
| `GOOGLE_CLIENT_ID`     | Opcional. ID de cliente de la app de Google que da el ingreso (termina en `.apps.googleusercontent.com`); vacío apaga el ingreso con Google     |
| `ROUTE_CACHE_CAPACITY` | Opcional. Cuántas rutas guarda la caché LRU (por defecto 200, entre 1 y 10.000)                                                                 |
| `TEST_DATABASE_URL`    | Opcional. Solo para las pruebas con PostgreSQL real: una base en tu computador cuyo nombre termina en `_test` (ver "Pruebas con base de datos") |

Sin `AI_SERVICE_URL` o sin `INTERNAL_TOKEN`, `POST /api/routes` responde 503 y el resto de la API funciona igual; el servidor lo avisa al arrancar.

Sin `GOOGLE_CLIENT_ID`, `POST /api/auth/google` responde 503 `AUTH_NOT_CONFIGURED` y el resto de la API funciona igual; el servidor también lo avisa al arrancar. El ID de cliente es público (el frontend usa el mismo), pero el **secreto del cliente no se usa en este proyecto y nunca se escribe aquí**: el formato del valor se revisa para que no se pegue por error.

Para generar `INTERNAL_TOKEN` (64 caracteres aleatorios):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El mismo valor va en el backend y en el servicio de IA. Nunca se escribe en `.env.example`, en un commit ni en un chat.

## Scripts

| Comando                 | Qué hace                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Inicia el servidor en modo desarrollo y lo reinicia al guardar cambios                                |
| `npm run build`         | Compila TypeScript a JavaScript en `dist/` (sin las pruebas)                                          |
| `npm start`             | Inicia el servidor compilado (lo usa Render)                                                          |
| `npm run typecheck`     | Revisa los tipos sin compilar                                                                         |
| `npm run lint`          | Revisa el código con ESLint                                                                           |
| `npm run format`        | Da formato al código con Prettier                                                                     |
| `npm test`              | Ejecuta las pruebas unitarias con Vitest                                                              |
| `npm run test:watch`    | Ejecuta las pruebas y las repite al guardar cambios                                                   |
| `npm run db:pull`       | Lee las tablas de la base de datos y actualiza `prisma/schema.prisma`                                 |
| `npm run import:roads`  | Importa la red vial de Pasto desde OpenStreetMap (ver `docs/IMPORTACION-OSM.md`)                      |
| `npm run seed:potholes` | Crea baches de prueba solo en la rama development (ver `docs/BACHES-DE-PRUEBA.md`)                    |
| `npm run user:role`     | Da o quita un rol a una cuenta, con confirmación (ver `docs/AUTENTICACION.md`)                        |
| `npm run trips:cleanup` | Borra los viajes de prueba de una cuenta; sin `--aplicar` solo los muestra (ver `docs/API-VIAJES.md`) |

## Endpoints

| Método | Ruta                             | Respuesta                                                                                             |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/`                              | Estado general de la API                                                                              |
| GET    | `/api/health`                    | Estado del servidor y de la base de datos (200 si está conectada, 503 si no)                          |
| GET    | `/api/hello`                     | "Hello World" con la confirmación de que la base de datos respondió (503 si no responde)              |
| GET    | `/api/docs`                      | Documentación interactiva (Swagger)                                                                   |
| GET    | `/api/docs.json`                 | Documento OpenAPI en JSON                                                                             |
| GET    | `/api/road-segments`             | Todas las calles como GeoJSON, con el color de cada tramo (ver `docs/API-MAPA.md`)                    |
| GET    | `/api/potholes`                  | Los baches como GeoJSON; `?includeRepaired=true` incluye los reparados                                |
| GET    | `/api/road-network/stats`        | Totales y leyenda del mapa                                                                            |
| GET    | `/api/roads/search`              | Sugiere calles por el comienzo del nombre, con dónde centrar el mapa (ver `docs/API-CALLES.md`)       |
| GET    | `/api/road-segments/:id/summary` | Resumen de un tramo: la parte de la calle a su alrededor y la calle entera (ver `docs/API-CALLES.md`) |
| GET    | `/api/roads/:id/summary`         | Resumen de una calle, o de la parte entre `from` y `to` (ver `docs/API-CALLES.md`)                    |
| POST   | `/api/routes`                    | Ruta entre dos puntos del mapa, lista para dibujar (ver "Rutas" más abajo)                            |
| POST   | `/api/auth/google`               | Ingreso con Google: recibe el token de Google y entrega una sesión (ver "Ingreso")                    |
| GET    | `/api/auth/me`                   | Quién es la persona de la sesión, con sus roles y permisos (necesita sesión)                          |
| POST   | `/api/auth/logout`               | Cierra la sesión que hace la petición, y solo esa (necesita sesión; responde 204)                     |
| POST   | `/api/trips`                     | Abre un viaje y entrega las reglas de las detecciones (permiso `detections.create`)                   |
| PATCH  | `/api/trips/:id`                 | Cierra un viaje con sus cuadros y su distancia (permiso `detections.create`)                          |
| GET    | `/api/trips`                     | Los viajes de la persona, página por página (permiso `trips.view_own`)                                |
| GET    | `/api/trips/:id`                 | Un viaje de la persona, con sus detecciones por severidad (permiso `trips.view_own`)                  |
| POST   | `/api/trips/:tripId/detections`  | Un lote de hasta 100 detecciones; se puede reenviar sin duplicar (permiso `detections.create`)        |
| POST   | `/api/clustering/runs`           | Pide una consolidación de baches ahora; responde 202 (permiso `clustering.run`)                       |
| GET    | `/api/clustering/runs`           | Estado del coordinador y últimas corridas (permiso `clustering.run`)                                  |

Los errores siempre responden en JSON con la forma `{ "error": { "code", "message" } }`, y algunos agregan `details` con datos para el frontend.

`/api/health` incluye un bloque `routeCache` con los aciertos, fallos y desalojos de la caché de rutas desde que arrancó el servidor.

### Rutas (para el frontend)

`POST /api/routes` recibe los dos clics y un criterio, y devuelve la ruta lista para pintar en el mapa:

```json
{
  "origin": { "latitude": 1.2136, "longitude": -77.2811 },
  "destination": { "latitude": 1.215, "longitude": -77.279 },
  "criterion": "balanced"
}
```

- **`criterion`**: `shortest` (la más corta, ignora los baches), `balanced` (por defecto) o `avoid_potholes` (evita los baches). Internamente es el factor `k` = 0, 1 o 3 del costo `longitud × (1 + k × daño)`.
- **`algorithm`** (opcional): `astar` (por defecto) o `dijkstra`. Dan la misma ruta; sirve para comparar en la presentación cuántos nodos explora cada uno.

La respuesta trae `criterion`, `algorithm`, `fromCache` (si salió de la caché), `origin` y `destination` (la esquina a la que se ajustó cada clic y a cuántos metros quedó), `summary` (`lengthM`, `cost`, `steps`, `exploredNodes`, `computationMs`) y `route`: un GeoJSON `FeatureCollection` con **una línea por tramo, en orden de viaje y con el trazado ya en el sentido del recorrido**. Cada tramo tiene en `properties` su `order`, `segmentId`, `roadName`, `reversed`, `lengthM`, `damageScore` y `cost`, así que el recorrido "anterior / siguiente" es avanzar por la lista. Además trae `streets`: las calles por las que pasa la ruta, en orden, con los baches de cada parte (opcional: si no se pueden calcular en ese momento, la ruta se responde sin él; ver `docs/API-CALLES.md`).

| Estado | Código                             | Qué mostrar                                                                                                                                                             |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `INVALID_REQUEST` o `INVALID_JSON` | Un error de la app: el cuerpo no es válido                                                                                                                              |
| 404    | `NO_ROUTE`                         | No hay camino que respete los sentidos de las calles                                                                                                                    |
| 422    | `OUTSIDE_NETWORK`                  | El punto `details.point` quedó a `details.distanceM` metros de la calle más cercana                                                                                     |
| 429    | `TOO_MANY_REQUESTS`                | Esperar `details.retryAfterS` segundos (también en el encabezado `Retry-After`)                                                                                         |
| 503    | `ROUTE_SERVICE_UNAVAILABLE`        | Con `details.retryAfterS`: el servicio de IA duerme; despertarlo desde el navegador y reintentar (ver abajo). Con solo `details.retryable`: ofrecer "intentar de nuevo" |
| 503    | `DATABASE_UNAVAILABLE`             | La base no respondió                                                                                                                                                    |

**El servicio de IA duerme y lo despierta el navegador.** En el plan gratuito de Render, el servicio de IA se duerme tras unos minutos sin uso, y Render solo lo despierta cuando lo pide un navegador: cuando lo pide el backend responde 429 con `x-render-routing: hibernate-rate-limited` y no lo despierta (comprobado en producción). Por eso el frontend debe:

1. **Al abrir la app**, despertar el servicio de IA desde el navegador sin esperar la respuesta: `fetch('https://urban-road-monitor-ai.onrender.com/health', { mode: 'no-cors' })`. Ese `/health` es público y no lleva token. Mientras la persona mira el mapa y elige los puntos, el servicio despierta (tarda cerca de un minuto).
2. **Si una ruta responde 503 `ROUTE_SERVICE_UNAVAILABLE` con `details.retryAfterS`**, mostrar "despertando el servicio de rutas…", volver a llamar ese `/health` desde el navegador y reintentar la ruta pasados `retryAfterS` segundos (30). Si `details.retryable` es `true` pero no trae `retryAfterS`, ofrecer "intentar de nuevo".

Cómo funciona por dentro:

1. Los dos clics se redondean a 4 decimales (unos 11 m) y la ruta se calcula para esos puntos, así que una ruta de la caché es idéntica a una recién calculada.
2. La versión de la red se reutiliza 10 segundos en memoria; si vence, las peticiones simultáneas comparten un solo cálculo.
3. La caché LRU (`src/structures/`) se busca con la clave `origen | destino | criterio | algoritmo | versión`.
4. Si la ruta no está, se pide al servicio de IA (`POST /routes`, con `INTERNAL_TOKEN`), con hasta 75 s de espera. Mientras el servicio de IA despierta en Render, Render puede responder al instante con 429, 502, 503 o 504, o con su página de carga (HTML), en vez de retener la petición (el servicio de IA nunca responde 429 por sí mismo); en esos casos, o si la conexión falla, el backend sigue intentando con pausas de 2, 4, 8, 8… segundos, o lo que pida Render en `Retry-After`, hasta completar los 75 s. Cada intento queda en el registro con el encabezado `x-render-routing` de Render, si lo envía. Un error propio del servicio en JSON (`NO_ROUTE`, `OUTSIDE_NETWORK`, token, `GRAPH_UNAVAILABLE`) termina la espera de inmediato. Si Render responde con `x-render-routing: hibernate-...` (por ejemplo `hibernate-rate-limited`), el backend no espera: responde enseguida 503 con `retryAfterS: 30`, porque Render no despierta el servicio para el backend y el frontend debe despertarlo desde el navegador.
5. Se leen de la base el trazado y el nombre de la calle de cada tramo, y los tramos recorridos al revés se dibujan invertidos.
6. La ruta se guarda congelada en la caché solo si el servicio usó la misma versión de la red; los errores no se guardan.

Las rutas no se guardan en la base de datos (`route_requests` y `route_steps` quedan para la Etapa 3), y hay un límite de 30 peticiones de ruta por minuto por dirección IP, que reutiliza la caché LRU para llevar la cuenta de cada dirección. En Render la dirección del cliente se toma del encabezado `True-Client-IP`, que escribe Cloudflare (el servicio que Render tiene delante) con la IP real, reemplazando cualquier valor que mande el cliente; en un computador, sin ese encabezado, se usa la dirección de la conexión. No se usa `X-Forwarded-For`, porque la petición pasa por varios intermediarios de Render y su cantidad no está documentada.

### Ingreso con Google (para el frontend)

`POST /api/auth/google` recibe el token que el botón de Google le da al frontend y entrega una sesión. Los detalles están en `docs/AUTENTICACION.md`.

```json
{ "credential": "<token de Google>" }
```

```json
{
  "token": "<identificador de 43 caracteres, se muestra una sola vez>",
  "expiresAt": "2026-11-17T12:00:00.000Z",
  "user": {
    "id": "…",
    "email": "…",
    "fullName": "…",
    "avatarUrl": "https://…",
    "roles": ["usuario"]
  }
}
```

El `token` se manda después en cada petición protegida como `Authorization: Bearer <token>`. Errores: 400 `INVALID_REQUEST`, 401 `INVALID_GOOGLE_TOKEN` (siempre el mismo mensaje, sea cual sea el motivo), 403 `ACCOUNT_DISABLED`, 429 (más de 10 intentos por minuto y dirección IP, con `Retry-After`) y 503 (`AUTH_PROVIDER_UNAVAILABLE`, `AUTH_NOT_CONFIGURED` o `DATABASE_UNAVAILABLE`). Los 503 no cierran nada: el frontend reintenta.

### Sesión, quién soy y salir (para el frontend)

Con el `token` en `Authorization: Bearer <token>`:

- `GET /api/auth/me` responde `{ "user": { …como el ingreso…, "permissions": ["…"] } }`. El frontend lo llama al abrir la página si guardó un identificador: un **401** significa que la sesión ya no sirve (se borra el identificador y se vuelve a la entrada); un **503** o un tiempo agotado **no** significan eso: se conserva el identificador y se reintenta. Los permisos se leen en cada petición, así que un rol recién dado se ve de inmediato.
- `POST /api/auth/logout` (sin cuerpo) cierra solo esa sesión y responde **204**. Si la sesión ya estaba cerrada, responde el 401 de siempre.
- Una ruta que exige un permiso usa `requirePermission('codigo')`: **401** sin sesión y **403** `FORBIDDEN` con sesión pero sin el permiso.
- Un cuerpo de más de 100 KB responde **413** `PAYLOAD_TOO_LARGE`.

### Viajes y detecciones (para el frontend)

El teléfono abre un viaje, manda lotes de detecciones mientras maneja y lo cierra. Todo necesita sesión y el permiso del rol `colaborador`. Lo esencial:

- **Empezar:** `POST /api/trips` con `{ device: { platform, browser?, label? }, modelVersion }`. Responde 201 con el `tripId`, el modelo y las reglas (`minConfidence`, `maxGpsAccuracyM`, `maxBatchSize`). Si `modelVersion` no es la del modelo activo, 409 `MODEL_VERSION_MISMATCH`.
- **Detecciones:** el teléfono pone un `id` (UUID) a cada una y **no manda la severidad**: el servidor la calcula con el área de la caja (menos de 1 % `leve`, hasta 4 % `moderado`, desde 4 % `grave`). Las malas no dan error: vuelven en `rejected` con su motivo. Reenviar un lote no duplica nada.
- **Cerrar:** `PATCH /api/trips/:id`. Se aceptan detecciones tardías hasta 24 horas después.
- **Límites:** 20 peticiones de viajes y 60 lotes por minuto y dirección IP.

El detalle, con ejemplos y todos los errores, está en `docs/API-VIAJES.md`. Antes de desplegar hay que correr `database/09_detections_base.sql` en la base (es idempotente).

### Consolidación de baches (para el administrador)

Las detecciones de los teléfonos se agrupan en baches con DBSCAN (en el servicio de IA) solas, después de cada envío y con una pausa mínima de 2 minutos entre corridas; un administrador puede pedir una con `POST /api/clustering/runs`. Solo los baches `confirmado` cambian el daño de los tramos y las rutas. El detalle está en `docs/API-CONSOLIDACION.md`. Antes de desplegar hay que correr `database/10_consolidation_base.sql` en la base (es idempotente).

### Calles: resúmenes y buscador (para el frontend)

`GET /api/road-segments/:id/summary` y `GET /api/roads/:id/summary` dicen cuántos baches hay y cuánto daño suman en un tramo, en la parte de la calle alrededor de él o en la calle entera; `GET /api/roads/search?q=` sugiere calles por su nombre. Son públicos. Los resúmenes salen de un árbol de segmentos por calle y el buscador de un trie, ambos en memoria (ver "Estructuras de datos" más abajo y `docs/API-CALLES.md`).

### Endpoint interno

Solo lo usa el servicio de IA para calcular rutas. No está en la lista de `GET /` y necesita el encabezado `Authorization: Bearer <INTERNAL_TOKEN>`.

| Método | Ruta              | Respuesta                                                                                               |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/internal/graph` | Red vial como grafo: la `version`, los nodos que usa algún tramo y todos los tramos, ordenados por `id` |

- **Sin `INTERNAL_TOKEN` configurado** responde 404, igual que una ruta que no existe. **Con un token ausente o incorrecto** responde 401, siempre con el mismo mensaje. Si la base de datos no responde, 503.
- **`version`** es un MD5 de los datos que usa el grafo (ids, extremos, longitud, daño, sentido, coordenadas y forma de cada tramo). Cambia si y solo si cambian esos datos; un cambio de severidad no la cambia.
- **`geometry`** de cada tramo son los puntos `[latitud, longitud]` con que se dibuja la calle, de `fromNodeId` a `toNodeId`: la IA ubica una detección sobre la curva real.
- **Una sola foto de la base:** la versión, los nodos y los tramos se leen en una transacción de solo lectura `REPEATABLE READ`, así que una importación o una actualización de daño en paralelo no deja tramos apuntando a nodos que no están en la lista.
- **`Cache-Control: no-store`**, y se comprime cuando el cliente lo acepta: con la red de Pasto son unos 1,4 MB de JSON y unos 200 KB por la red.

## Estructuras de datos de la caché de rutas

`src/structures/` tiene tres estructuras escritas a mano, sin `Map` ni `Set` de JavaScript ni ninguna librería. Las usará `POST /api/routes` (bloque 7 de la Etapa 2) para responder rutas repetidas sin volver a llamar al servicio de IA.

| Estructura  | Archivo                          | Cómo funciona                                                                                                                                                                                                                                                   | Complejidad                                                           |
| ----------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tabla hash  | `hash-table.ts` (con `fnv1a.ts`) | Arreglo de cubetas; cada cubeta es una lista simple con las claves que cayeron ahí (encadenamiento separado). La cubeta sale del hash FNV-1a de 32 bits de la clave. Cuando el factor de carga pasaría de 0,75, duplica las cubetas y redistribuye las entradas | `get`, `set`, `delete` y `has` O(1) en promedio; O(n) en el peor caso |
| Lista doble | `doubly-linked-list.ts`          | Como en la materia: cada nodo tiene un valor y dos punteros, al siguiente y al anterior; el primero es la cabeza (`head`) y el último la cola (`tail`). Las operaciones reciben y devuelven nodos, y cada nodo sabe a qué lista pertenece                       | `pushFront`, `moveToFront`, `remove` y `popBack` O(1)                 |
| Caché LRU   | `lru-cache.ts`                   | La tabla hash guarda, por cada clave, su nodo en la lista; la lista guarda el orden de uso (la cabeza es lo más reciente). Al llenarse, saca la cola: la entrada que lleva más tiempo sin usarse                                                                | `get`, `peek`, `set` y `delete` O(1) en promedio                      |

- **Capacidad por cantidad de entradas**, mínimo 1. Con 200 rutas, la tabla crece hasta 512 cubetas y se queda ahí, y la caché ocupa como mucho unos 2 MB.
- **Sin caducidad por tiempo:** la versión de la red forma parte de la clave, así que las rutas viejas dejan de coincidir y la caché las saca a medida que entran las nuevas.
- **`get` cuenta como uso** y mueve la entrada a la cabeza; `peek` no cambia el orden ni las estadísticas.
- **`stats()`** devuelve aciertos, fallos y desalojos, para mostrar el porcentaje de aciertos.
- **`isValid()`** comprueba los invariantes de cada estructura en O(n): la tabla y la lista deben coincidir entrada por entrada.
- **La caché no copia los valores:** quien la use no debe modificar lo que guarda.

Cada estructura se prueba de dos formas: con ejemplos legibles y con miles de operaciones al azar (semilla fija) comparadas después de cada paso contra una versión simple hecha solo con arreglos. La función hash se prueba con los valores publicados de FNV-1a, y las colisiones se fuerzan a propósito.

### Árbol de segmentos y trie

Dos estructuras más, también escritas a mano, para las calles:

| Estructura         | Archivo                                              | Cómo funciona                                                                                                                                                                                     | Complejidad                                                               |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Árbol de segmentos | `segment-tree.ts` (la usa `src/roads/road-index.ts`) | Un árbol por calle sobre sus tramos en orden: cada hoja es un tramo y cada nodo suma a sus hijos con una operación asociativa (largo, baches, daño). Se arma de abajo hacia arriba, sin recursión | Sumar una parte de la calle y cambiar un tramo, O(log n); armarlo, O(n)   |
| Trie               | `trie.ts` (lo usa `src/roads/road-search-index.ts`)  | Los nombres de las calles se escriben letra por letra en un árbol; lo que empieza con un prefijo cuelga de un mismo nodo. Los resultados salen en orden alfabético                                | Insertar y buscar un prefijo, O(largo del prefijo) más lo que se devuelve |

Se prueban igual que las anteriores: con ejemplos y con 40 semillas al azar comparadas contra una versión simple.

## Estructura

Arquitectura por capas, siguiendo el diagrama del profesor: rutas → controladores → servicios → repositorios → base de datos.

```
data/                  Datos descargados de OpenStreetMap (los ignora Git)
database/              Scripts SQL, diagrama entidad-relación y su README
docs/                  Guías de uso, como la importación de la red vial
prisma/                Esquema de Prisma (generado con npm run db:pull)
src/
├── auth/              Sesiones (duración, identificador, datos que se guardan), ingreso con Google (verificador del token, identidad, nombre y foto) y el comando de roles
├── config/            Variables de entorno y conexión única a la base (Singleton)
├── controllers/       Reciben la petición y responden con el código HTTP correcto
├── docs/              Documento OpenAPI que muestra Swagger
├── errors/            Errores de la aplicación con su código HTTP
├── geojson/           Tipos GeoJSON y conversión de coordenadas para el mapa
├── middlewares/       CORS, compresión, token interno, límite por IP, 404 y errores
├── repositories/      Acceso a la base de datos con Prisma (patrón Repository)
├── osm/               Importación de la red vial: consulta, lectura, tramos e informe
├── routes/            Rutas de la API REST
├── clustering/        Consolidación: contrato con la IA, estado y reconciliación de los baches (funciones puras)
├── roads/             Calles en memoria: árbol de segmentos por calle, calles de una ruta y buscador por nombre
├── routing/           Petición de ruta: criterios, redondeo de los clics y clave de la caché
├── scripts/           Comandos que se ejecutan a mano, como import-roads y user-role
├── seed/              Baches de prueba: generador, corredores, plan y protecciones
├── services/          Lógica de negocio
├── structures/        Estructuras escritas a mano: tabla hash, lista doble, caché LRU, árbol de segmentos y trie
├── test/              Apoyo para las pruebas: base PostgreSQL (con sus protecciones) y claves que hacen de Google
├── app.ts             Configuración de Express
└── server.ts          Punto de entrada: inicia el servidor
```

## Pruebas con base de datos

`npm test` corre sin ninguna base. Las pruebas que revisan el SQL de verdad (sesiones, registros de acceso, cuentas, el ingreso con Google y la migración 08) se omiten solas si no existe `TEST_DATABASE_URL`. Ver `docs/AUTENTICACION.md`.

Para activarlas, una sola vez en tu computador:

1. Crea una base vacía llamada `urban_road_monitor_test` (en pgAdmin, o con `psql -U postgres -c "CREATE DATABASE urban_road_monitor_test"`).
2. Ejecútale, conectado como dueño de la base, en este orden: `database/00_run_all.sql`, `06_add_segment_geometry.sql`, `07_add_geometry_to_segment_status_view.sql`, `08_auth_base.sql`, `09_detections_base.sql` y `10_consolidation_base.sql`. No hace falta `05_app_user.sql`.
3. Agrega a tu `.env`: `TEST_DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/urban_road_monitor_test`.

Protecciones: estas pruebas vacían tablas, así que solo aceptan una base en `localhost` cuyo nombre termine en `_test`. Una dirección de Neon o de otra base se rechaza antes de conectar. Solo `TEST_DATABASE_URL` se lee del `.env` para las pruebas; el `DATABASE_URL` real nunca llega a ellas.

Las pruebas del ingreso con Google tampoco tocan Google: firman los tokens con una clave que se crea en el momento (`src/test/google-test-keys.ts`) y le dan esa clave a la librería real de Google, así que la verificación de la firma, de la audiencia y del vencimiento es la verdadera.

Los archivos de prueba corren uno tras otro (`fileParallelism: false` en `vitest.config.ts`): comparten esa base y la vacían antes de cada prueba, así que en paralelo un archivo borraría los datos que otro está usando.

## Despliegue en Render

El servicio se describe en `render.yaml` (región Virginia, plan gratuito, Node 24).

| Configuración     | Valor                                   |
| ----------------- | --------------------------------------- |
| Build Command     | `npm ci --include=dev && npm run build` |
| Start Command     | `npm start`                             |
| Health Check Path | `/api/health`                           |

Variables que se configuran en el panel de Render (no van en el repositorio):

| Variable               | Valor                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Conexión de `app_user` a la rama `production` de Neon (en tu computador se usa `development`)           |
| `CORS_ORIGIN`          | URL del frontend en Vercel                                                                              |
| `INTERNAL_TOKEN`       | Token compartido con el servicio de IA. Mientras no se configure, `/internal/graph` responde 404        |
| `AI_SERVICE_URL`       | `https://urban-road-monitor-ai.onrender.com`. Mientras no se configure, `POST /api/routes` responde 503 |
| `GOOGLE_CLIENT_ID`     | ID de cliente de la app de Google. Mientras no se configure, `POST /api/auth/google` responde 503       |
| `ROUTE_CACHE_CAPACITY` | Opcional; 200 si no se configura                                                                        |

Cada `push` a `main` vuelve a desplegar el servicio si tiene activado Auto-Deploy; si no, se despliega con **Manual Deploy** desde el panel de Render.
En el plan gratuito el servicio se duerme tras unos minutos sin uso: la primera petición después de eso tarda unos segundos.

## Equipo y responsabilidades

| Integrante    | Responsabilidad                                            |
| ------------- | ---------------------------------------------------------- |
| Arley Riascos | Todos los commits del backend y de la implementación de IA |
| Kevin Basante | Todos los commits del frontend                             |

Los dos trabajan juntos en videollamada para que ambos conozcan todo el proyecto. Los primeros commits de cada repositorio se hicieron en conjunto y llevan la línea `Co-authored-by:`.

## Convenciones

- Código, comentarios, rutas y claves JSON en inglés; documentación en español.
- Todo se trabaja directo en `main`, sin ramas ni pull requests (indicación del profesor). Antes de empezar y antes de cada `push` se hace `git pull`.
- Commits pequeños, uno por cambio con sentido, con el mensaje en inglés y prefijos convencionales: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`, `perf`, `style`.
- Cada integrante hace sus commits con su propia cuenta de GitHub. Solo los commits hechos en conjunto incluyen la línea `Co-authored-by:`.
- Antes de cada commit se ejecutan `npm run typecheck`, `npm run lint` y `npm test`.
