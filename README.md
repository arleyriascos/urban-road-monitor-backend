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

## Scripts

| Comando             | Qué hace                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Inicia el servidor en modo desarrollo y lo reinicia al guardar cambios |
| `npm run build`     | Compila TypeScript a JavaScript en `dist/`                             |
| `npm start`         | Inicia el servidor compilado (lo usa Render)                           |
| `npm run typecheck` | Revisa los tipos sin compilar                                          |
| `npm run lint`      | Revisa el código con ESLint                                            |
| `npm run format`    | Da formato al código con Prettier                                      |

## Estructura

```
database/       Scripts SQL, diagrama entidad-relación y su README
src/
├── app.ts      Configuración de la aplicación Express
└── server.ts   Punto de entrada: inicia el servidor
```

## Convenciones

- Código, comentarios, rutas y claves JSON en inglés; documentación en español.
- Cada tarea se trabaja en una rama y entra a `main` mediante un pull request revisado por el otro integrante.
- Los commits hechos en conjunto incluyen la línea `Co-authored-by:`.
