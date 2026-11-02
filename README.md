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

| Variable         | Descripción                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `development`, `production` o `test`                                                               |
| `PORT`           | Puerto del servidor (por defecto 3000)                                                             |
| `DATABASE_URL`   | Conexión a PostgreSQL en Neon con el usuario `app_user`                                            |
| `CORS_ORIGIN`    | Orígenes del frontend permitidos, separados por comas                                              |
| `INTERNAL_TOKEN` | Opcional. Token compartido con el servicio de IA (mínimo 32 caracteres); vacío apaga `/internal/*` |

Para generar `INTERNAL_TOKEN` (64 caracteres aleatorios):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

El mismo valor va en el backend y en el servicio de IA. Nunca se escribe en `.env.example`, en un commit ni en un chat.

## Scripts

| Comando                 | Qué hace                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`           | Inicia el servidor en modo desarrollo y lo reinicia al guardar cambios             |
| `npm run build`         | Compila TypeScript a JavaScript en `dist/` (sin las pruebas)                       |
| `npm start`             | Inicia el servidor compilado (lo usa Render)                                       |
| `npm run typecheck`     | Revisa los tipos sin compilar                                                      |
| `npm run lint`          | Revisa el código con ESLint                                                        |
| `npm run format`        | Da formato al código con Prettier                                                  |
| `npm test`              | Ejecuta las pruebas unitarias con Vitest                                           |
| `npm run test:watch`    | Ejecuta las pruebas y las repite al guardar cambios                                |
| `npm run db:pull`       | Lee las tablas de la base de datos y actualiza `prisma/schema.prisma`              |
| `npm run import:roads`  | Importa la red vial de Pasto desde OpenStreetMap (ver `docs/IMPORTACION-OSM.md`)   |
| `npm run seed:potholes` | Crea baches de prueba solo en la rama development (ver `docs/BACHES-DE-PRUEBA.md`) |

## Endpoints

| Método | Ruta                      | Respuesta                                                                                |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/`                       | Estado general de la API                                                                 |
| GET    | `/api/health`             | Estado del servidor y de la base de datos (200 si está conectada, 503 si no)             |
| GET    | `/api/hello`              | "Hello World" con la confirmación de que la base de datos respondió (503 si no responde) |
| GET    | `/api/docs`               | Documentación interactiva (Swagger)                                                      |
| GET    | `/api/docs.json`          | Documento OpenAPI en JSON                                                                |
| GET    | `/api/road-segments`      | Todas las calles como GeoJSON, con el color de cada tramo (ver `docs/API-MAPA.md`)       |
| GET    | `/api/potholes`           | Los baches como GeoJSON; `?includeRepaired=true` incluye los reparados                   |
| GET    | `/api/road-network/stats` | Totales y leyenda del mapa                                                               |

Los errores siempre responden en JSON con la forma `{ "error": { "code", "message" } }`.

### Endpoint interno

Solo lo usa el servicio de IA para calcular rutas. No está en la lista de `GET /` y necesita el encabezado `Authorization: Bearer <INTERNAL_TOKEN>`.

| Método | Ruta              | Respuesta                                                                                               |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/internal/graph` | Red vial como grafo: la `version`, los nodos que usa algún tramo y todos los tramos, ordenados por `id` |

- **Sin `INTERNAL_TOKEN` configurado** responde 404, igual que una ruta que no existe. **Con un token ausente o incorrecto** responde 401, siempre con el mismo mensaje. Si la base de datos no responde, 503.
- **`version`** es un MD5 de los datos que usa el grafo (ids, extremos, longitud, daño, sentido y coordenadas). Cambia si y solo si cambian esos datos; un cambio de geometría o de severidad no la cambia.
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

## Estructura

Arquitectura por capas, siguiendo el diagrama del profesor: rutas → controladores → servicios → repositorios → base de datos.

```
data/                  Datos descargados de OpenStreetMap (los ignora Git)
database/              Scripts SQL, diagrama entidad-relación y su README
docs/                  Guías de uso, como la importación de la red vial
prisma/                Esquema de Prisma (generado con npm run db:pull)
src/
├── config/            Variables de entorno y conexión única a la base (Singleton)
├── controllers/       Reciben la petición y responden con el código HTTP correcto
├── docs/              Documento OpenAPI que muestra Swagger
├── errors/            Errores de la aplicación con su código HTTP
├── geojson/           Tipos GeoJSON y conversión de coordenadas para el mapa
├── middlewares/       CORS, compresión, token interno, rutas inexistentes (404) y errores
├── repositories/      Acceso a la base de datos con Prisma (patrón Repository)
├── osm/               Importación de la red vial: consulta, lectura, tramos e informe
├── routes/            Rutas de la API REST
├── scripts/           Comandos que se ejecutan a mano, como import-roads
├── seed/              Baches de prueba: generador, corredores, plan y protecciones
├── services/          Lógica de negocio
├── structures/        Estructuras escritas a mano: tabla hash, lista doble y caché LRU
├── app.ts             Configuración de Express
└── server.ts          Punto de entrada: inicia el servidor
```

## Despliegue en Render

El servicio se describe en `render.yaml` (región Virginia, plan gratuito, Node 24).

| Configuración     | Valor                                   |
| ----------------- | --------------------------------------- |
| Build Command     | `npm ci --include=dev && npm run build` |
| Start Command     | `npm start`                             |
| Health Check Path | `/api/health`                           |

Variables que se configuran en el panel de Render (no van en el repositorio):

| Variable         | Valor                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`   | Conexión de `app_user` a la rama `production` de Neon (en tu computador se usa `development`)    |
| `CORS_ORIGIN`    | URL del frontend en Vercel                                                                       |
| `INTERNAL_TOKEN` | Token compartido con el servicio de IA. Mientras no se configure, `/internal/graph` responde 404 |

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
