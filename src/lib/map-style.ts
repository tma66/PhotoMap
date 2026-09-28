// Raster sources and globe sky shared by TripMap.tsx (trip map) and
// GlobeMap.tsx (home globe) — kept in one place so the two don't drift out
// of sync on tile URLs/attribution.
import type { RasterSourceSpecification, SkySpecification } from "maplibre-gl";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

function rasterSource(
  tile: string,
  attribution: string,
): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [tile],
    tileSize: 256,
    attribution,
    maxzoom: 19,
  };
}

export function satelliteSource(): RasterSourceSpecification {
  return MAPBOX_TOKEN
    ? rasterSource(
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`,
        "© Mapbox",
      )
    : rasterSource(
        `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
        "© Esri",
      );
}

// Plain street map, for the trip page's satellite/streets toggle. It carries
// its own labels, so it needs no separate labels overlay.
export function streetsSource(): RasterSourceSpecification {
  return MAPBOX_TOKEN
    ? rasterSource(
        // The classic `mapbox.streets` raster tileset (`/v4/...`) has been
        // retired (410 Gone) — the Static Tiles API (rendering any modern
        // style as plain raster PNGs) replaces it.
        `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
        "© Mapbox",
      )
    : rasterSource(
        `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
        "© Esri",
      );
}

// Free, keyless place-name/boundary labels overlay — layered on top of the
// satellite imagery regardless of imagery source, since Mapbox's raster
// tile API only serves plain imagery (labels are vector-only there).
export function labelsSource(): RasterSourceSpecification {
  return rasterSource(
    `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    "© Esri",
  );
}

// Atmosphere glow around the globe, fading out as it flattens into a map.
export const GLOBE_SKY: SkySpecification = {
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
};
