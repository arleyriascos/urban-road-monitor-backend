# API del mapa: contrato para el frontend

Tres endpoints públicos y de solo lectura que alimentan el mapa. El invitado también puede usarlos. Todos responden JSON, y los dos primeros siguen el formato GeoJSON.

| Método | Ruta                      | Qué devuelve                                                              |
| ------ | ------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/road-segments`      | Todas las calles de Pasto como líneas, con el color según su estado       |
| GET    | `/api/potholes`           | Los baches como puntos. Con `?includeRepaired=true` incluye los reparados |
| GET    | `/api/road-network/stats` | Totales y leyenda del mapa                                                |

- **Local:** `http://localhost:3000`
- **Producción:** `https://urban-road-monitor-backend.onrender.com`
- **Documentación interactiva:** `/api/docs` (Swagger)

## Empezar sin esperar al backend

La carpeta `docs/samples/` trae datos de muestra con **exactamente la misma forma** que las respuestas reales: una ciudad de ejemplo de 8 × 8 calles junto a la Plaza de Nariño, con 24 baches (22 sin contar los reparados).

| Archivo                          | Equivale a                            |
| -------------------------------- | ------------------------------------- |
| `road-segments.sample.geojson`   | `GET /api/road-segments` (112 tramos) |
| `potholes.sample.geojson`        | `GET /api/potholes`                   |
| `road-network-stats.sample.json` | `GET /api/road-network/stats`         |

Pueden copiarse a `public/` del frontend y cargarse con `fetch('/road-segments.sample.geojson')` mientras tanto. Cuando el backend esté listo, solo cambia la URL.

## Tipos de TypeScript

Se pueden copiar tal cual a `src/types/map.ts` del frontend.

```ts
export type Severity = 'sin baches' | 'leve' | 'moderado' | 'grave';
export type PotholeSeverity = Exclude<Severity, 'sin baches'>;
export type PotholeStatus = 'sin confirmar' | 'confirmado' | 'reparado';

/** GeoJSON usa [longitud, latitud]. */
export type Position = [longitude: number, latitude: number];

export interface SegmentProperties {
  roadId: number;
  name: string | null;
  roadType: string;
  lengthM: number;
  /** Si es true, el tránsito va en el sentido de la línea (del primer al último punto). */
  isOneway: boolean;
  /** Suma de peso de severidad x confianza. Costo de ruta = lengthM x (1 + damageScore). */
  damageScore: number;
  severity: Severity;
  /** Color para dibujar el tramo. */
  color: string;
  activePotholes: number;
}

export interface SegmentFeature {
  type: 'Feature';
  id: number;
  geometry: { type: 'LineString'; coordinates: Position[] };
  properties: SegmentProperties;
}

export interface SegmentCollection {
  type: 'FeatureCollection';
  features: SegmentFeature[];
}

export interface PotholeProperties {
  severity: PotholeSeverity;
  color: string;
  status: PotholeStatus;
  /** De 0 a 1. */
  confidence: number;
  detectionCount: number;
  segmentId: number | null;
  roadName: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

export interface PotholeFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: Position };
  properties: PotholeProperties;
}

export interface PotholeCollection {
  type: 'FeatureCollection';
  features: PotholeFeature[];
}

export interface NetworkStats {
  roads: number;
  segments: number;
  totalLengthKm: number;
  /** Leyenda: de "sin baches" a la peor severidad. */
  segmentsBySeverity: { severity: Severity; color: string; count: number }[];
  potholesByStatus: { status: PotholeStatus; count: number }[];
  lastPotholeDetectedAt: string | null;
}

export interface ApiError {
  error: { code: string; message: string };
}
```

## Ejemplos de respuesta

Un tramo con un bache grave (de `GET /api/road-segments`):

```json
{
  "type": "Feature",
  "id": 10,
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-77.2793, 1.2145],
      [-77.2784, 1.2145]
    ]
  },
  "properties": {
    "roadId": 2,
    "name": "Calle 11",
    "roadType": "Vía terciaria",
    "lengthM": 100.05,
    "isOneway": true,
    "damageScore": 5.8128,
    "severity": "grave",
    "color": "#DC2626",
    "activePotholes": 1
  }
}
```

Un tramo sin baches:

```json
{
  "type": "Feature",
  "id": 1,
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-77.2811, 1.2136],
      [-77.2802, 1.2136]
    ]
  },
  "properties": {
    "roadId": 1,
    "name": "Calle 10",
    "roadType": "Calle residencial",
    "lengthM": 100.05,
    "isOneway": false,
    "damageScore": 0,
    "severity": "sin baches",
    "color": "#22C55E",
    "activePotholes": 0
  }
}
```

Un bache (de `GET /api/potholes`):

```json
{
  "type": "Feature",
  "id": "fb6a2bd3-c567-4f68-9a06-bea4394eb7a3",
  "geometry": {
    "type": "Point",
    "coordinates": [-77.278802, 1.2172]
  },
  "properties": {
    "severity": "leve",
    "color": "#FACC15",
    "status": "confirmado",
    "confidence": 0.75,
    "detectionCount": 2,
    "segmentId": 31,
    "roadName": "Calle 14",
    "firstDetectedAt": "2026-09-26T05:39:20.362Z",
    "lastDetectedAt": "2026-10-24T11:13:20.362Z"
  }
}
```

`GET /api/road-network/stats`:

```json
{
  "roads": 16,
  "segments": 112,
  "totalLengthKm": 11.26,
  "segmentsBySeverity": [
    {
      "severity": "sin baches",
      "color": "#22C55E",
      "count": 90
    },
    {
      "severity": "leve",
      "color": "#FACC15",
      "count": 6
    },
    {
      "severity": "moderado",
      "color": "#F97316",
      "count": 9
    },
    {
      "severity": "grave",
      "color": "#DC2626",
      "count": 7
    }
  ],
  "potholesByStatus": [
    {
      "status": "sin confirmar",
      "count": 4
    },
    {
      "status": "confirmado",
      "count": 18
    },
    {
      "status": "reparado",
      "count": 2
    }
  ],
  "lastPotholeDetectedAt": "2026-10-24T11:13:20.362Z"
}
```

## Dibujarlo con Leaflet

`L.geoJSON` entiende GeoJSON y ya invierte el orden `[longitud, latitud]` por su cuenta. Si dibujas a mano con `L.polyline`, hay que invertirlo.

```ts
const map = L.map('map', { preferCanvas: true }).setView([1.2136, -77.2811], 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

L.geoJSON(segments, {
  style: (feature) => ({ color: feature?.properties.color, weight: 4, opacity: 0.9 }),
}).addTo(map);

L.geoJSON(potholes, {
  pointToLayer: (feature, latlng) =>
    L.circleMarker(latlng, {
      radius: 7,
      color: '#111827',
      weight: 1,
      fillColor: feature.properties.color,
      fillOpacity: 0.9,
    }),
}).addTo(map);
```

## Lo que hay que tener en cuenta

- **Usa `preferCanvas: true`.** La ciudad completa tiene unos 10.000 tramos. Con el dibujo SVG por defecto, Leaflet se pone lento; con canvas se mueve fluido.
- **El tamaño:** `/api/road-segments` pesa unos 3 MB sin comprimir, pero el servidor lo comprime con gzip (unos 130 KB) y el navegador lo descomprime solo. También envía un `ETag`: si el navegador ya lo tiene y no cambió, el servidor responde 304 sin reenviar nada.
- **Estados de la pantalla:** el profesor exige mostrar carga, error y resultado. El backend en Render gratuito se duerme tras unos minutos sin uso, y la primera petición puede tardar hasta un minuto: el estado de carga debe aguantar ese tiempo. Los errores llegan como `ApiError` con un `code` (`INVALID_QUERY` con 400, `INTERNAL_ERROR` con 500).
- **Sentido de las calles:** `isOneway: true` significa que el tránsito va del primer al último punto de la línea. Dibujar flechas es opcional.
- **Qué datos hay en cada rama:** la base `development` tendrá baches de prueba. La base `main`, que usa Render, tendrá las calles reales y **ningún bache** hasta que haya detecciones reales, así que en producción el mapa se verá todo verde.
- **Colores:** usa siempre el campo `color` de la respuesta. Hoy son `#22C55E` (sin baches), `#FACC15` (leve), `#F97316` (moderado) y `#DC2626` (grave).
- **Cuándo pedir:** `road-segments` y `road-network/stats` al abrir el mapa. `potholes` también al abrir; no hace falta pedirlos de nuevo al mover el mapa, porque se devuelve toda la ciudad.
