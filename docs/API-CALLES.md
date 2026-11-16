# Calles: resúmenes y buscador (Etapa 4, paquete 5)

Tres cosas para el mapa, todas **públicas** (los invitados pueden usarlas, porque solo leen): el resumen de un tramo para su ventanita, el resumen de una calle (o de una parte) y el buscador de calles por nombre. Además, la ruta ahora dice por qué calles pasa.

## Las dos estructuras

- **Árbol de segmentos (Segment Tree):** cada calle es un árbol sobre sus tramos en orden. Cada hoja guarda lo de un tramo (largo, baches, daño) y cada nodo suma a sus dos hijos. Sumar una parte cualquiera de la calle ("del tramo 3 al 9") cuesta O(log n), sin recorrer los tramos. Está en `src/structures/segment-tree.ts`, genérico: recibe la operación con que se suman dos nodos (debe ser asociativa, no necesariamente conmutativa).
- **Trie (árbol de prefijos):** los nombres de las calles se escriben letra por letra en un árbol; todo lo que empieza con "cal" cuelga de un mismo nodo, así que sugerir cuesta lo que mide lo escrito más lo que se encuentra. Está en `src/structures/trie.ts`. El trie vive en el backend: el frontend solo muestra las sugerencias.

Ambos se prueban con ejemplos y con 40 semillas al azar comparadas contra una versión simple con arreglos.

## Qué se suma

`StretchSummary` (cada parte de una calle):

| Campo                 | Qué es                                                           |
| --------------------- | ---------------------------------------------------------------- |
| `segments`, `lengthM` | Cuántos tramos y cuántos metros                                  |
| `visiblePotholes`     | Baches que no están reparados: los que dibuja el mapa            |
| `confirmedPotholes`   | Baches vistos al menos dos veces: los únicos que cambian el daño |
| `damageScore`         | El daño de los tramos sumado (peso de la severidad × confianza)  |
| `worstSeverity`       | La peor severidad entre los baches confirmados, o `null`         |

## Resumen de un tramo y de una calle

| Método | Ruta                                      | Respuesta                                                                                                                                    |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/road-segments/:id/summary?radius=2` | El tramo, la parte de la calle alrededor (el tramo y `radius` tramos a cada lado, de 0 a 20, por defecto 2) y la calle entera                |
| GET    | `/api/roads/:id/summary`                  | La calle entera                                                                                                                              |
| GET    | `/api/roads/:id/summary?from=3&to=9`      | Solo los tramos entre esas dos posiciones (ambas incluidas, empiezan en 0; se pasan las dos o ninguna, y `from` no puede ser mayor que `to`) |

- Un rango sin tramos responde una parte vacía (0 tramos), no un error.
- 404 `SEGMENT_NOT_FOUND` o `ROAD_NOT_FOUND` si no existe; 400 `INVALID_REQUEST` si el id o los números no son válidos.
- **Frescura:** el índice vive en memoria y cada 10 segundos pregunta a la base, con una consulta barata, si cambiaron los tramos o los baches; solo si cambiaron lo reconstruye. Una consolidación llega a las respuestas en menos de 10 segundos, y los navegadores pueden guardar una respuesta 10 segundos (`Cache-Control: public, max-age=10`).
- Límite: 120 peticiones por minuto y dirección IP.

## Las calles de una ruta

`POST /api/routes` suma el campo `streets` a su respuesta: una entrada por cada calle que recorre la ruta, en orden. Los pasos seguidos sobre la misma calle forman una sola entrada.

```json
{
  "roadId": 7,
  "roadName": "Calle 18",
  "fromOrder": 1,
  "toOrder": 4,
  "steps": 4,
  "fromSegmentIndex": 3,
  "toSegmentIndex": 6,
  "summary": {
    "segments": 4,
    "lengthM": 402.5,
    "visiblePotholes": 2,
    "confirmedPotholes": 1,
    "damageScore": 3,
    "worstSeverity": { "name": "grave", "weight": 6 }
  }
}
```

`fromOrder` y `toOrder` son los pasos (`properties.order`) de la ruta que quedan en esa calle. Es un extra: si no se pueden calcular las calles en ese momento, la ruta se responde igual **sin** `streets`; el frontend debe tratarlo como opcional.

## Buscador de calles

`GET /api/roads/search?q=cal&limit=8`

- `q`: lo escrito (de 1 a 100 caracteres). Se ignoran mayúsculas, tildes y espacios de más: "AVENIDA PASTÓ" encuentra "Avenida Pasto".
- `limit`: de 1 a 20, por defecto 8.

```json
{
  "query": "cal",
  "streets": [
    {
      "name": "Calle 18",
      "roadIds": [7, 12],
      "segments": 24,
      "center": { "latitude": 1.2136, "longitude": -77.2811 },
      "bounds": {
        "minLatitude": 1.211,
        "maxLatitude": 1.216,
        "minLongitude": -77.284,
        "maxLongitude": -77.278
      }
    }
  ]
}
```

- Salen primero las calles cuyo nombre **empieza** con lo escrito, en orden alfabético, y después las que tienen una palabra posterior que empieza así ("18" encuentra "18 de Octubre" y luego "Calle 18").
- OpenStreetMap parte una calle larga en muchos trazos con el mismo nombre; aquí son **una sola calle**: `roadIds` trae todos (para resaltarlos), y `center` y `bounds` abarcan todos (para centrar el mapa o ajustar el zoom).
- Las calles sin nombre no se pueden buscar. Si nada coincide, `streets` es una lista vacía (200), no un error.
- El índice se revisa contra la base a lo sumo cada minuto, y los navegadores pueden guardar la respuesta un minuto. Límite: 120 peticiones por minuto y dirección IP. El frontend debe esperar un momento entre letras antes de preguntar.
