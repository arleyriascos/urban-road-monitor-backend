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

| Variable       | Descripción                                             |
| -------------- | ------------------------------------------------------- |
| `NODE_ENV`     | `development`, `production` o `test`                    |
| `PORT`         | Puerto del servidor (por defecto 3000)                  |
| `DATABASE_URL` | Conexión a PostgreSQL en Neon con el usuario `app_user` |
| `CORS_ORIGIN`  | Orígenes del frontend permitidos, separados por comas   |

## Scripts

| Comando             | Qué hace                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Inicia el servidor en modo desarrollo y lo reinicia al guardar cambios |
| `npm run build`     | Compila TypeScript a JavaScript en `dist/`                             |
| `npm start`         | Inicia el servidor compilado (lo usa Render)                           |
| `npm run typecheck` | Revisa los tipos sin compilar                                          |
| `npm run lint`      | Revisa el código con ESLint                                            |
| `npm run format`    | Da formato al código con Prettier                                      |

## Endpoints

| Método | Ruta             | Respuesta                                                                                |
| ------ | ---------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/`              | Estado general de la API                                                                 |
| GET    | `/api/health`    | Estado del servidor y de la base de datos (200 si está conectada, 503 si no)             |
| GET    | `/api/hello`     | "Hello World" con la confirmación de que la base de datos respondió (503 si no responde) |
| GET    | `/api/docs`      | Documentación interactiva (Swagger)                                                      |
| GET    | `/api/docs.json` | Documento OpenAPI en JSON                                                                |

Los errores siempre responden en JSON con la forma `{ "error": { "code", "message" } }`.

## Estructura

Arquitectura por capas, siguiendo el diagrama del profesor: rutas → controladores → servicios → repositorios → base de datos.

```
database/              Scripts SQL, diagrama entidad-relación y su README
prisma/                Esquema de Prisma (generado con npm run db:pull)
src/
├── config/            Variables de entorno y conexión única a la base (Singleton)
├── controllers/       Reciben la petición y responden con el código HTTP correcto
├── docs/              Documento OpenAPI que muestra Swagger
├── errors/            Errores de la aplicación con su código HTTP
├── middlewares/       CORS, rutas inexistentes (404) y manejo de errores
├── repositories/      Acceso a la base de datos con Prisma (patrón Repository)
├── routes/            Rutas de la API REST
├── services/          Lógica de negocio
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

| Variable       | Valor                                           |
| -------------- | ----------------------------------------------- |
| `DATABASE_URL` | Conexión de `app_user` a la rama `main` de Neon |
| `CORS_ORIGIN`  | URL del frontend en Vercel                      |

Cada vez que se integra un pull request a `main`, Render vuelve a desplegar automáticamente.
En el plan gratuito el servicio se duerme tras unos minutos sin uso: la primera petición después de eso tarda unos segundos.

## Convenciones

- Código, comentarios, rutas y claves JSON en inglés; documentación en español.
- Cada tarea se trabaja en una rama y entra a `main` mediante un pull request revisado por el otro integrante.
- Los commits hechos en conjunto incluyen la línea `Co-authored-by:`.
