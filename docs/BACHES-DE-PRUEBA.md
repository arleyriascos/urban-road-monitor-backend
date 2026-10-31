# Baches de prueba

El comando `npm run seed:potholes` crea baches **inventados** en la base de datos para ver los colores en el mapa y, más adelante, comprobar que las rutas esquivan las calles dañadas. Hasta que haya detecciones reales, es la única forma de tener un mapa con baches.

**Solo para la rama `development` de Neon.** Los baches de prueba nunca deben llegar a `production`, porque esa base es la que ve el profesor.

## Qué crea

Por defecto, 60 baches con la misma distribución en cada ejecución:

- El 70% se concentra en 6 calles del centro de Pasto (los "corredores"). Son calles con nombre, de al menos 300 m, que prefieren ser vías principales y tienen varias calles paralelas cerca, para que una ruta pueda ir por otro lado.
- El 30% se reparte por el resto de la ciudad.
- Los corredores tienen baches más graves que el resto.
- El 15% está "sin confirmar", el 10% "reparado" y el resto "confirmado", cada uno con su confianza y sus fechas.
- Después de crear los baches, calcula el daño de cada tramo: la suma del peso de la severidad por la confianza de cada bache que no está reparado.

## Las protecciones

El comando se niega a escribir si:

1. `NODE_ENV` es `production` (así nunca puede correr en Render).
2. No declaraste en tu `.env` cuál es el servidor permitido (`SEED_ALLOWED_HOST`).
3. El servidor de `DATABASE_URL` no es ese servidor permitido.
4. La base de datos ya tiene detecciones reales.

Además, siempre pide que escribas `si` después de mostrar el servidor y la base de destino.

## Preparación (una sola vez)

1. En Neon, rama **development**, botón **Connect**, copia el host: lo que va entre la arroba y la barra, por ejemplo `ep-algo-123456.us-east-1.aws.neon.tech`.
2. En tu archivo `.env`, completa la línea:

```
SEED_ALLOWED_HOST=ep-algo-123456.us-east-1.aws.neon.tech
```

Ese host debe ser el mismo que aparece en tu `DATABASE_URL`. **No** pongas esta variable en Render.

## Paso 1: ver el plan

```powershell
npm run seed:potholes -- --dry-run
```

Muestra cuántos baches crearía, por severidad y por estado, y cuáles son los 6 corredores. No escribe nada.

## Paso 2: crearlos

```powershell
npm run seed:potholes
```

Muestra el servidor y la base de destino. Compara el servidor con el de la rama **development** y escribe `si`. Si no coincide, escribe otra cosa: no se guarda nada.

## Repetir, cambiar o quitar

| Comando                                | Qué hace                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run seed:potholes`                | Reemplaza todos los baches por 60 nuevos. Con la misma semilla salen siempre los mismos |
| `npm run seed:potholes -- --count 100` | Crea 100 baches                                                                         |
| `npm run seed:potholes -- --seed 7`    | Usa otra semilla y crea una distribución distinta                                       |
| `npm run seed:potholes -- --count 0`   | Borra los baches de prueba y deja todos los tramos sin daño                             |

Cada ejecución **reemplaza todos los baches** de la base, y se hace en una sola transacción: si algo falla, no cambia nada. Los baches reparados y sin confirmar también se crean, para ver todos los estados.

## Verificar en pgAdmin

```sql
SELECT ps.name AS estado, sl.name AS severidad, COUNT(*) AS cantidad
FROM potholes p
JOIN pothole_statuses ps ON ps.id = p.status_id
JOIN severity_levels sl ON sl.id = p.severity_level_id
GROUP BY ps.name, sl.name
ORDER BY ps.name, sl.name;

SELECT COUNT(*) AS tramos_con_dano FROM road_segments WHERE damage_score > 0;
```

También se puede abrir `/api/potholes` y `/api/road-network/stats` del backend local para ver el resultado.

## Si algo falla

| Mensaje                                      | Qué hacer                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| `Falta SEED_ALLOWED_HOST en tu archivo .env` | Agrega la línea de la sección "Preparación"                 |
| `no es el servidor permitido`                | El `.env` apunta a otra rama de Neon. Revisa `DATABASE_URL` |
| `NODE_ENV=production`                        | No se puede ejecutar así. Es la protección para Render      |
| `ya tiene ... detecciones reales`            | Ya hay datos reales: no se crean baches de prueba           |
| `No hay tramos en la base de datos`          | Importa primero la red vial (`docs/IMPORTACION-OSM.md`)     |
