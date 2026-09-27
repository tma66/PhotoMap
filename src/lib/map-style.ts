// Satellite imagery + place-name labels raster sources shared by TripMap.tsx
// (flat map) and GlobeMap.tsx (home globe) — kept in one place so the two
// don't drift out of sync on tile URLs/attribution.
import type { RasterSourceSpecification } from "maplibre-gl";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function satelliteSource(): RasterSourceSpecification {
  const tiles = MAPBOX_TOKEN
    ? [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`,
      ]
    : [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ];

  return {
    type: "raster",
    tiles,
    tileSize: 256,
    attribution: MAPBOX_TOKEN ? "© Mapbox" : "© Esri",
    maxzoom: 19,
  };
}

// Plain street map, for the trip page's satellite/streets toggle. Mapbox's
// classic raster tile API serves its own labels for this one (unlike
// mapbox.satellite), so it needs no separate labels overlay.
export function streetsSource(): RasterSourceSpecification {
  const tiles = MAPBOX_TOKEN
    ? [
        // The classic `mapbox.streets` raster tileset (`/v4/...`) Mapbox used
        // to serve here has been retired (410 Gone) — the Static Tiles API
        // (rendering any modern style as plain raster PNGs) replaces it.
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      ]
    : [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      ];

  return {
    type: "raster",
    tiles,
    tileSize: 256,
    attribution: MAPBOX_TOKEN ? "© Mapbox" : "© Esri",
    maxzoom: 19,
  };
}

// Free, keyless place-name/boundary labels overlay — layered on top of the
// satellite imagery regardless of imagery source, since Mapbox's raster
// tile API only serves plain imagery (labels are vector-only there).
export function labelsSource(): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    ],
    tileSize: 256,
    attribution: "© Esri",
    maxzoom: 19,
  };
}
