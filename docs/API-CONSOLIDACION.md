# Consolidación de baches (Etapa 4, paquete 5)

Este documento explica cómo las detecciones que mandan los teléfonos se convierten en **baches** del mapa: el backend las agrupa con DBSCAN (que corre en el servicio de IA), mantiene cada bache y su estado, y recalcula el daño de los tramos. Pasa solo, después de cada envío, y un administrador puede pedirlo a mano.

## Qué hace una corrida

1. Lee las detecciones de los últimos **90 días** (parámetro `clustering_window_days`), hasta 20 000.
2. Se las manda al servicio de IA (`POST /clusters`) con la distancia y el mínimo de puntos de DBSCAN (`dbscan_eps_meters` = 5 m, `dbscan_min_points` = 2). La IA solo ve posiciones, no ids de la base: el backend envía el lugar de cada detección en la lista y lo traduce al volver.
3. **Reconcilia** los grupos con los baches que ya existen, para que un bache conserve su `id` entre corridas:
   - Cada grupo se queda con el bache al que ya pertenecían la mayoría de sus detecciones; si ninguno, con el más cercano dentro de la distancia de DBSCAN.
   - Un bache que ya no tiene grupo se borra, **salvo si está reparado**: esos se conservan.
   - Un bache **reparado** vuelve a `sin confirmar` o `confirmado` solo si llegó una detección **más nueva que la reparación**.
   - Los baches de prueba (sembrados) nunca se tocan.
4. Guarda todo en **una transacción**: borra, crea o actualiza los baches, enlaza las detecciones con su bache y recalcula el daño de los tramos que cambiaron.
5. Anota la corrida en `clustering_runs`: cuántos grupos halló, cuántos baches quitó, cuántos días leyó y, si falló, el código del error.

**Solo los baches `confirmado` (vistos al menos dos veces) cambian el daño y las rutas.** Los `sin confirmar` se ven en el mapa, pero no desvían ninguna ruta.

## Cuándo corre

- **Automática, después de cada envío:** cuando un lote guarda detecciones nuevas, el backend avisa al coordinador, que espera 5 segundos (para juntar lotes) y corre. Entre dos corridas automáticas pasan al menos **120 segundos** (`clustering_min_interval_s`).
- **Si falla,** reintenta a los 5, 10, 20 y 30 minutos, y sigue cada 30. El servicio de IA gratuito de Render duerme y responde 429 con `x-render-routing: hibernate-…`: en ese caso la corrida no espera, falla con `AI_HIBERNATING` y se reintenta más tarde.
- **Al arrancar el servidor,** a los 30 segundos revisa si llegaron detecciones después de la última corrida buena y, si es así, corre.
- **A mano,** con el botón del administrador (abajo).
- **Una sola a la vez:** un índice único parcial en la base impide dos corridas `running`, aunque haya varios servidores. Una que lleva más de 10 minutos `running` se da por abandonada.
- Si el servidor no tiene `AI_SERVICE_URL` e `INTERNAL_TOKEN`, el coordinador no arranca y se avisa en el registro.

## Para el administrador

Necesita sesión y el permiso `clustering.run`. Límite: 10 peticiones por minuto y dirección IP.

| Método | Ruta                            | Respuesta                                                                                |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/api/clustering/runs`          | **202** `{ "status": "started" }`: la corrida empezó en segundo plano                    |
| GET    | `/api/clustering/runs?limit=10` | `{ status, runs }`: el estado del coordinador y las últimas corridas (`limit` de 1 a 50) |

`status` trae `running`, `nextRunAt`, `failuresInARow` y `pendingDetections` (detecciones recibidas después de la última corrida buena). Cada corrida trae su estado (`running`, `finished`, `failed`), cómo empezó (`automatic` o `manual`), cuántos grupos halló y cuántos baches quitó.

| Estado    | Código                   | Qué significa                                      |
| --------- | ------------------------ | -------------------------------------------------- |
| 401 / 403 |                          | Sin sesión o sin el permiso `clustering.run`       |
| 409       | `RUN_IN_PROGRESS`        | Ya hay una corrida en marcha                       |
| 503       | `CLUSTERING_UNAVAILABLE` | El servidor no tiene configurado el servicio de IA |

Los códigos de error de una corrida fallida (`error_code`) son `AI_HIBERNATING`, `AI_UNAVAILABLE`, `AI_REJECTED`, `AI_BROKEN_ANSWER` y `DATABASE_ERROR`.

## Antes de desplegar

Hay que correr `database/10_consolidation_base.sql` en la base de pruebas, en Neon `development` y en Neon `production`, **antes** de desplegar el código (es idempotente). Los baches de prueba siguen existiendo solo en `development`.

**Cambio de regla en los baches de prueba:** el daño de los tramos ahora cuenta solo los baches `confirmado`. Los baches sembrados en `development` se calcularon con la regla anterior (todo lo que no estaba reparado); la consolidación solo recalcula los tramos que toca, así que para ver todo con la regla nueva hay que volver a sembrar.

## Cómo se probó

- Las piezas puras (decisión de estado, reconciliación, contrato con la IA) con ejemplos y con 60 semillas al azar que comprueban que correr dos veces da lo mismo.
- El cliente de la IA, el coordinador (con reloj falso) y el servicio.
- Con PostgreSQL de verdad: corridas completas con una IA falsa que hace DBSCAN, el recálculo del daño, la corrida única y los permisos del botón.
