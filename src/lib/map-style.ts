// Raster sources and globe sky shared by TripMap.tsx (trip map) and
// GlobeMap.tsx (home globe) — kept in one place so the two don't drift out
// of sync on tile URLs/attribution.
import type {
  RasterSourceSpecification,
  SkySpecification,
  VectorSourceSpecification,
} from "maplibre-gl";

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

// The trip map's street map: a Mapbox Studio copy of Classic Streets with
// every label and shield layer hidden, since the trip map draws names itself
// near the ground (namesSource). Labels baked into raster tiles balloon to
// twice their size at every zoom level a flight passes through. Classic, as
// the Static Tiles API can't render Standard. Owned by the account the
// token comes from.
const STREETS_UNLABELED_STYLE = "mu3tang/cmvkpagcp001f01r7dmgxha22";

export function streetsBaseSource(): RasterSourceSpecification {
  return MAPBOX_TOKEN
    ? rasterSource(
        // 256: the API's default 512px tiles come back 1024px at @2x —
        // 4× the pixels (and ~4.5× the bytes) the 256-unit source draws,
        // which made flights choppier than satellite's 512px JPEGs.
        `https://api.mapbox.com/styles/v1/${STREETS_UNLABELED_STYLE}/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
        "© Mapbox",
      )
    : streetsSource();
}

// The same style at the API's default 512px tiles (1024px at @2x): one zoom
// level more detail (side streets, parking lots) at 4× the pixels. The trip
// map blends it in only near the ground — null without a Mapbox token.
export function streetsDetailSource(): RasterSourceSpecification | null {
  return MAPBOX_TOKEN
    ? rasterSource(
        `https://api.mapbox.com/styles/v1/${STREETS_UNLABELED_STYLE}/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
        "© Mapbox",
      )
    : null;
}

// Place and street names as vector data, drawn by the trip map only near the
// ground — null without a Mapbox token (the Esri tiles keep their labels).
export function namesSource(): VectorSourceSpecification | null {
  return MAPBOX_TOKEN
    ? {
        type: "vector",
        tiles: [
          `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${MAPBOX_TOKEN}`,
        ],
        maxzoom: 16,
        attribution: "© Mapbox",
      }
    : null;
}

export const NAMES_GLYPHS = `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${MAPBOX_TOKEN}`;

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
