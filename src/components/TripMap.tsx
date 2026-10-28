"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import {
  buildRouteLegs,
  curvedArc,
  legsToGeoJSON,
  type RouteStep,
} from "@/lib/route";
import { shortenedEase } from "@/lib/flight-easing";
import { haversineKm, type LatLng } from "@/lib/geo";
import { isHeaven } from "@/lib/heaven";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import HeavenScene from "./HeavenScene";
import {
  GLOBE_SKY,
  labelsSource,
  NAMES_GLYPHS,
  namesSource,
  satelliteSource,
  streetsBaseSource,
  streetsDetailSource,
  STREETS_HAVE_LABELS,
} from "@/lib/map-style";
import {
  landingTiles,
  tilesAcross,
  tileUrl,
  type TileXYZ,
} from "@/lib/tile-prefetch";

export interface MapStep extends RouteStep {
  locationName: string;
  /** HeavenScene's larger pin. */
  thumbUrl: string | null;
  pinUrl: string | null;
}

export type MapStyleMode = "satellite" | "streets";

interface TripMapProps {
  steps: MapStep[];
  activeStepId: string | null;
  isScrubbing?: boolean;
  /** Something opaque (the story view) covers the whole map. */
  hidden?: boolean;
  styleMode: MapStyleMode;
  /** Whether the dotted route lines are drawn. */
  showRoute: boolean;
  onSelectStep: (id: string) => void;
}

// White reads clearly against satellite imagery but nearly disappears
// against the streets style's light background, so the route line switches
// to the same blue as the active pin's ring there — see the styleMode
// effect below.
function routeColorFor(styleMode: MapStyleMode): string {
  return styleMode === "streets" ? "#0099E5" : "#ffffff";
}

const LOW_RES_MAX_ZOOM = 2;
const MID_RES_ZOOM = 3;
// Single-zoom layers under the detail, one per zoom 6–12, so a long flight's
// climb shows real roads and shores while the detail is hidden
// (setDetailShown). MapLibre draws none of a layer's tiles while the map is
// more than one zoom below it (raster tiles are one zoom above the map's), so
// each starts one zoom below its own and reaches one above, finer on top: a
// tile not loaded yet shows the coarser one (≤4× stretched), not blur. Zoom
// 12 reaches 13, so it's loaded at a step already. The URLs the hidden detail
// layer loads at each zoom anyway.
const CLIMB_BANDS = [6, 7, 8, 9, 10, 11, 12].map((zoom) => ({
  zoom,
  from: zoom - 1,
  to: Math.min(zoom + 1, 13),
}));
const climbLayers = (styleMode: MapStyleMode) =>
  CLIMB_BANDS.map(({ zoom }) => `${styleMode}-z${zoom}`);
const climbBand = (id: string) =>
  CLIMB_BANDS.find(({ zoom }) => id.endsWith(`-z${zoom}`));
const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };
// Heaven in two steps each way: the camera rises to the globe, then
// HeavenScene fades in; leaving, it fades out first, then the camera flies
// back down. The fade's length is .heaven-scene's transition in globals.css.
const HEAVEN_FLIGHT_MS = 1800;
const HEAVEN_FADE_MS = 1800;
// The fade-out's ease curve is front-loaded: the scene is effectively gone
// about two thirds of the way through, so the camera leaves then rather than
// sitting still for the fade's invisible tail.
const HEAVEN_GONE_MS = HEAVEN_FADE_MS * 0.65;

// Camera for a step at 0,0 (see src/lib/heaven.ts): pulled back to the whole
// globe — turned to the last place on Earth before it — sitting low in the
// map, with open sky above it for HeavenScene.
function heavenCamera(
  map: maplibregl.Map,
  steps: MapStep[],
  step: MapStep,
): maplibregl.CameraOptions & { padding: maplibregl.PaddingOptions } {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const before = steps.slice(0, steps.indexOf(step)).reverse();
  const earthly = [...before, ...steps].find((s) => !isHeaven(s));
  // Globe and clouds together fill most of the map above the cards.
  const radius = Math.min(w * 0.44, h * 0.24);
  return {
    center: [earthly?.lng ?? 0, 0],
    // Globe radius in px is worldSize / 2π, worldSize = 512 · 2^zoom.
    zoom: Math.log2((radius * 2 * Math.PI) / 512),
    bearing: 0,
    pitch: 0,
    padding: { ...NO_PADDING, top: h * 0.24 }, // globe centre at 62% down
  };
}

// Where HeavenScene goes: the globe's top edge (the highest projected point
// on the centre meridian, from the centre up to the pole) and a width scaled
// to the globe's on-screen radius.
function heavenPlacement(map: maplibregl.Map): { top: number; width: number } {
  const center = map.getCenter();
  let top = Infinity;
  for (let lat = center.lat; lat <= 90; lat += 1) {
    top = Math.min(top, map.project([center.lng, lat]).y);
  }
  const radius = map.project(center).y - top;
  const { clientWidth } = map.getContainer();
  return { top, width: Math.min(clientWidth * 0.92, radius * 2.3) };
}
const LONG_FLIGHT_KM = 300; // same cutoff ingest uses for a flight leg
// A 5 s flight's take-off (up to the globe, 1.5 s) as is, its descent sped
// up to land at 4 s (see src/lib/flight-easing.ts).
const LONG_FLIGHT_MS = 4000;
const LONG_FLIGHT_EASING = shortenedEase(5000, 1500, LONG_FLIGHT_MS);
// The camera's zoom at a step. MapLibre lays lines out per whole zoom
// level and stretches them in between, so dashes (and paw prints) grow
// while a flight zooms in and snap back to their shortest the moment it
// lands on a whole level. Landing a hair below one keeps them at the longer
// length they arrive with. Imagery is unaffected: raster tiles are picked by
// rounding, so this still shows zoom-13 tiles.
const STEP_ZOOM = 12.999;

// A pet's trip (one that ends in heaven, see src/lib/heaven.ts) gets a trail
// of paw prints instead of the dashed route, and the pet itself walking
// from pin to pin.

// One paw print, toes up, for the trail's symbol layer.
function drawPaw(color: string): ImageData {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.canvas.width = ctx.canvas.height = 40;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(20, 27, 10, 8.5, 0, 0, Math.PI * 2);
  for (const [x, y] of [
    [8, 15],
    [15, 8],
    [25, 8],
    [32, 15],
  ] as const) {
    ctx.moveTo(x + 4.2, y);
    ctx.arc(x, y, 4.2, 0, Math.PI * 2);
  }
  ctx.fill();
  return ctx.getImageData(0, 0, 40, 40);
}

// Walks the pet from where it is now to `to` along the same curve as the
// trail, in step with the camera flying there: as far along the arc
// as the camera is along its own way. Rides a car instead when `drive`
// (moving to another city). Returns a function that stops it where it is.
function walkPet(
  map: maplibregl.Map,
  pet: maplibregl.Marker,
  to: LatLng,
  drive: boolean,
): () => void {
  const from = pet.getLngLat();
  const km = haversineKm(from, to);
  if (km < 0.05) {
    pet.setLngLat([to.lng, to.lat]);
    return () => {};
  }
  const path = curvedArc(from, to, 48);
  const el = pet.getElement();
  el.classList.toggle("walking-pet-car", drive);
  // Both drawings face left; flipped when heading east.
  el.classList.toggle("walking-pet-east", to.lng > from.lng);
  el.classList.add("walking-pet-moving");

  const cameraFrom = map.getCenter();
  const cameraKm = haversineKm(cameraFrom, to);
  const move = () => {
    const left = haversineKm(map.getCenter(), to);
    const t = cameraKm > 0 ? Math.min(1, Math.max(0, 1 - left / cameraKm)) : 1;
    const at = t * (path.length - 1);
    const a = path[Math.floor(at)]!;
    const b = path[Math.min(path.length - 1, Math.floor(at) + 1)]!;
    const f = at - Math.floor(at);
    pet.setLngLat([a.lng + (b.lng - a.lng) * f, a.lat + (b.lat - a.lat) * f]);
  };
  const stop = () => {
    map.off("move", move);
    map.off("moveend", arrive);
    el.classList.remove("walking-pet-moving", "walking-pet-car");
  };
  function arrive() {
    stop();
    pet.setLngLat([to.lng, to.lat]);
  }
  map.on("move", move);
  map.on("moveend", arrive);
  return stop;
}

// Place and street names, drawn live from vector data only near the ground:
// labels baked into raster tiles balloon to twice their size at every zoom
// level a flight passes through. Above PLACE_NAMES_ZOOM no name tiles are
// even fetched, so a flight shows none mid-air. Without a Mapbox token
// (NAMES null), Esri's labelled tiles and labels overlay stand in.
//
// Quiet, like the reference app: places by importance (big cities first),
// small muted text, neighbourhoods in spaced caps — so names don't compete
// with the photos and pins, and don't pile up over a city while climbing.
const NAMES = namesSource();
// Streets tiles from Mapbox's own style carry their labels (STREETS_HAVE_LABELS).
const STREETS_NAMES = NAMES != null && !STREETS_HAVE_LABELS;
const PLACE_NAMES_ZOOM = 8; // big cities; every town from 10
const NEIGHBOURHOOD_NAMES_ZOOM = 11;
const WATER_NAMES_ZOOM = 10;
const STREET_NAMES_ZOOM = 12; // STEP_ZOOM is just under 13
const NAME_COLORS: Record<
  MapStyleMode,
  { place: string; minor: string; halo: string; haloWidth: number }
> = {
  satellite: {
    place: "rgba(255, 255, 255, 0.95)",
    minor: "rgba(255, 255, 255, 0.9)",
    halo: "rgba(0, 0, 0, 0.7)",
    haloWidth: 1.4,
  },
  streets: {
    place: "#4a5866",
    minor: "#6b7885",
    halo: "rgba(255, 255, 255, 0.85)",
    haloWidth: 1,
  },
};
const NAME_FONT = ["DIN Pro Regular", "Arial Unicode MS Regular"];

function nameLayers(
  styleMode: MapStyleMode,
): maplibregl.SymbolLayerSpecification[] {
  const name: maplibregl.ExpressionSpecification = [
    "coalesce",
    ["get", "name_en"],
    ["get", "name"],
  ];
  const colors = NAME_COLORS[styleMode];
  const paint = (color: string) => ({
    "text-color": color,
    "text-halo-color": colors.halo,
    "text-halo-width": colors.haloWidth,
  });
  return [
    {
      id: `street-names-${styleMode}`,
      type: "symbol",
      source: "names",
      "source-layer": "road",
      minzoom: STREET_NAMES_ZOOM,
      filter: ["has", "name"],
      layout: {
        "symbol-placement": "line",
        "text-field": name,
        "text-size": 10.5,
        "text-font": NAME_FONT,
      },
      paint: paint(colors.minor),
    },
    {
      id: `water-names-${styleMode}`,
      type: "symbol",
      source: "names",
      "source-layer": "natural_label",
      minzoom: WATER_NAMES_ZOOM,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["ocean", "sea", "water", "reservoir"]],
      ],
      layout: {
        "text-field": name,
        "text-size": 11,
        "text-font": ["DIN Pro Italic", "Arial Unicode MS Regular"],
      },
      paint: paint(colors.minor),
    },
    {
      id: `neighbourhood-names-${styleMode}`,
      type: "symbol",
      source: "names",
      "source-layer": "place_label",
      minzoom: NEIGHBOURHOOD_NAMES_ZOOM,
      filter: ["==", ["get", "class"], "settlement_subdivision"],
      layout: {
        "text-field": ["upcase", name],
        "text-size": 10,
        "text-letter-spacing": 0.15,
        "text-font": NAME_FONT,
      },
      paint: paint(colors.minor),
    },
    {
      // Mapbox's symbolrank: lower is more important.
      id: `place-names-${styleMode}`,
      type: "symbol",
      source: "names",
      "source-layer": "place_label",
      minzoom: PLACE_NAMES_ZOOM,
      filter: [
        "all",
        ["==", ["get", "class"], "settlement"],
        ["<=", ["get", "symbolrank"], ["step", ["zoom"], 9, 10, 18]],
      ],
      layout: {
        "text-field": name,
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 13, 14],
        "text-font": NAME_FONT,
      },
      paint: paint(colors.place),
    },
  ];
}

// Raster layers shown per style, bottom to top.
// Streets flies on light tiles; near the ground the detailed ones fade in
// with the camera's descent (0% at DETAIL_ZOOM, 100% at DETAIL_FULL_ZOOM)
// rather than over a fixed time, so the side streets emerge as it closes in.
// Fully in by DETAIL_FULL_ZOOM (~0.55 s before a long flight lands), as sharp as
// satellite by then: its tiles are loaded by then anyway. Below DETAIL_ZOOM
// the layer is off and none of its tiles are fetched.
const STREETS_DETAIL = streetsDetailSource();
const DETAIL_ZOOM = 12;
const DETAIL_FULL_ZOOM = 12.5;
const RASTER_LAYERS: Record<MapStyleMode, string[]> = {
  satellite: [
    "satellite-low",
    "satellite-mid",
    ...climbLayers("satellite"),
    "satellite",
    ...(NAMES ? [] : ["labels"]),
  ],
  streets: [
    "streets-low",
    "streets-mid",
    ...climbLayers("streets"),
    "streets",
    ...(STREETS_DETAIL ? ["streets-detail"] : []),
  ],
};
// Every layer shown per style: its rasters, then its names on top.
const BASE_LAYERS: Record<MapStyleMode, string[]> = {
  satellite: [
    ...RASTER_LAYERS.satellite,
    ...(NAMES ? nameLayers("satellite").map((l) => l.id) : []),
  ],
  streets: [
    ...RASTER_LAYERS.streets,
    ...(STREETS_NAMES ? nameLayers("streets").map((l) => l.id) : []),
  ],
};
// The streets tiles are toned down so the photos and pins stay the brightest
// things on the map, and the white header text keeps some contrast.
const STREETS_PAINT = {
  "raster-saturation": -0.45,
  "raster-brightness-max": 0.9,
} as const;
// Drawing order of all of them.
const ALL_RASTER_LAYERS = [
  "satellite-low",
  "streets-low",
  "satellite-mid",
  "streets-mid",
  ...climbLayers("satellite"),
  ...climbLayers("streets"),
  "satellite",
  "streets",
  ...(STREETS_DETAIL ? ["streets-detail"] : []),
  ...(NAMES ? [] : ["labels"]),
];
const ALL_NAME_LAYERS = [
  ...(NAMES ? nameLayers("satellite") : []),
  ...(STREETS_NAMES ? nameLayers("streets") : []),
];
const ALL_BASE_LAYERS = [
  ...ALL_RASTER_LAYERS,
  ...ALL_NAME_LAYERS.map((l) => l.id),
];

const RASTER_SOURCES: Record<
  MapStyleMode,
  () => maplibregl.RasterSourceSpecification
> = {
  satellite: satelliteSource,
  streets: streetsBaseSource,
};

// Warms the browser cache with every low-res underlay tile (21 in total for
// zooms 0–2) so the first long flight doesn't wait on them mid-air and show
// dark holes. MapLibre requests the same URLs later and gets cache hits.
// Once per style per page load — later trip pages reuse the same tiles.
function prefetchLowResTiles(styleMode: MapStyleMode): void {
  const template = RASTER_SOURCES[styleMode]().tiles?.[0];
  if (!template) return;
  const urls: string[] = [];
  for (let z = 0; z <= LOW_RES_MAX_ZOOM; z++) {
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++)
        urls.push(tileUrl(template, { z, x, y }));
    }
  }
  prefetch(urls);
}

// Fades the live names out (or back in) through text-opacity, leaving
// their visibility to the satellite/streets toggle.
function setNamesShown(map: maplibregl.Map, shown: boolean): void {
  for (const { id } of ALL_NAME_LAYERS) {
    if (map.getLayer(id))
      map.setPaintProperty(id, "text-opacity", shown ? 1 : 0);
  }
}

// Hides the detailed base tiles for a long flight's climb, leaving the
// layers beneath (CLIMB_BANDS and the low-res underlay): climbing faster than
// tiles at each zoom can be drawn, the map otherwise keeps the departure's
// sharp tiles as a square amid the blur. They fade out with height, gone two
// zooms up before that square forms, and back in over a second.
const DETAIL_HIDDEN = [
  "interpolate",
  ["linear"],
  ["zoom"],
  STEP_ZOOM - 2,
  0,
  STEP_ZOOM,
  1,
] as maplibregl.ExpressionSpecification;
function setDetailShown(map: maplibregl.Map, shown: boolean): void {
  for (const id of ["satellite", "streets"]) {
    if (map.getLayer(id)) {
      map.setPaintProperty(id, "raster-opacity-transition", {
        duration: shown ? 1000 : 0,
        delay: 0,
      });
      map.setPaintProperty(id, "raster-opacity", shown ? 1 : DETAIL_HIDDEN);
    }
  }
}

// Warms the browser cache with the tiles a landing on `to` needs, so the
// flight there finds them ready instead of sharpening late: the raster at
// map zooms 9–13 (256px tiles, one zoom higher: 10–14) and the names (512px
// tiles: 8–12), plus streets' detail layer. The last zooms of the descent
// cover the whole `width`×`height` screen (a phone needs 3×5 raster tiles);
// higher up, where the camera passes quickly, the 2×2 nearest the step.
// About 60 tiles (80 on streets), each fetched once per page load; the map
// would fetch the same on landing anyway.
const prefetchedTiles = new Set<string>();
function prefetchLanding(
  styleMode: MapStyleMode,
  to: LatLng,
  width: number,
  height: number,
): void {
  const raster = RASTER_SOURCES[styleMode]().tiles?.[0];
  const names =
    styleMode === "streets" && !STREETS_NAMES ? undefined : NAMES?.tiles?.[0];
  const detail =
    styleMode === "streets" ? STREETS_DETAIL?.tiles?.[0] : undefined;
  // Tiles are drawn 256–512px wide (raster) or 512–1024px (names).
  const rasterScreen = [tilesAcross(width, 256), tilesAcross(height, 256)];
  const namesScreen = [tilesAcross(width, 512), tilesAcross(height, 512)];
  const tiles = (template: string | undefined, sets: TileXYZ[][]) =>
    template ? sets.flat().map((t) => tileUrl(template, t)) : [];
  const urls = [
    ...tiles(raster, [
      landingTiles(to, 10, 12),
      landingTiles(to, 13, 14, rasterScreen[0], rasterScreen[1]),
    ]),
    ...tiles(names, [
      landingTiles(to, PLACE_NAMES_ZOOM, 11),
      landingTiles(to, 12, 12, namesScreen[0], namesScreen[1]),
    ]),
    // Map zooms 12–13 (~210 KB a tile); at 12 it's still mostly faded out.
    ...tiles(detail, [
      landingTiles(to, 13, 13),
      landingTiles(to, 14, 14, rasterScreen[0], rasterScreen[1]),
    ]),
  ];
  prefetch(urls);
}

// Warms the cache with the climb layers' tiles (CLIMB_BANDS) around a step
// with a long flight either way, the whole screen at each zoom (~105 tiles,
// 3×5 per zoom on a phone; the ones the hidden detail layer fetches on that
// flight anyway), so the climb layers draw whole screens taking off and the
// descent's lower zooms are ready on landing.
function prefetchClimb(
  styleMode: MapStyleMode,
  at: LatLng,
  width: number,
  height: number,
): void {
  const raster = RASTER_SOURCES[styleMode]().tiles?.[0];
  if (!raster) return;
  prefetch(
    landingTiles(
      at,
      CLIMB_BANDS[0]!.zoom,
      CLIMB_BANDS.at(-1)!.zoom,
      tilesAcross(width, 256),
      tilesAcross(height, 256),
    ).map((t) => tileUrl(raster, t)),
  );
}

function prefetch(urls: string[]): void {
  for (const url of urls) {
    if (prefetchedTiles.has(url)) continue;
    prefetchedTiles.add(url);
    fetch(url).catch(() => {});
  }
}

// Satellite and streets are both always in the style; the toggle just flips
// which raster layer is visible (see the styleMode effect below) instead of
// swapping maplibregl.Map's style wholesale, which would also wipe and
// require re-adding the route/pin layers added on "style.load".
//
// Globe projection (matching the reference app's trip map): at street zoom it
// renders flat, but a flyTo between distant steps pulls back to a sphere in
// space and arcs across it. Only the visible hemisphere's few low-zoom tiles
// load mid-flight, instead of a flat map sweeping hundreds of tiles across
// the whole distance (which stuttered and got rate-limited).
function buildMapStyle(styleMode: MapStyleMode): maplibregl.StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: GLOBE_SKY,
    ...(NAMES ? { glyphs: NAMES_GLYPHS } : {}),
    sources: {
      satellite: satelliteSource(),
      streets: streetsBaseSource(),
      ...(NAMES ? { names: NAMES } : { labels: labelsSource() }),
      // Same imagery capped at zoom 2 (16 tiles for the whole world), drawn
      // underneath — mid-flight, any detailed tile that hasn't arrived yet
      // shows a blurry version of the same map instead of a dark hole.
      "satellite-low": { ...satelliteSource(), maxzoom: LOW_RES_MAX_ZOOM },
      "streets-low": { ...streetsBaseSource(), maxzoom: LOW_RES_MAX_ZOOM },
      // Zoom 3 only (64 tiles for the world, fetched as needed) over it: a
      // sharper globe while the detail is hidden on a long flight (see
      // setDetailShown); a tile not loaded yet shows the zoom 2 one beneath.
      "satellite-mid": {
        ...satelliteSource(),
        minzoom: MID_RES_ZOOM,
        maxzoom: MID_RES_ZOOM,
      },
      "streets-mid": {
        ...streetsBaseSource(),
        minzoom: MID_RES_ZOOM,
        maxzoom: MID_RES_ZOOM,
      },
      ...Object.fromEntries(
        CLIMB_BANDS.flatMap(({ zoom }) => [
          [
            `satellite-z${zoom}`,
            { ...satelliteSource(), minzoom: zoom, maxzoom: zoom },
          ],
          [
            `streets-z${zoom}`,
            { ...streetsBaseSource(), minzoom: zoom, maxzoom: zoom },
          ],
        ]),
      ),
      ...(STREETS_DETAIL ? { "streets-detail": STREETS_DETAIL } : {}),
    },
    layers: [
      {
        id: "space",
        type: "background",
        paint: { "background-color": "#04101c" },
      },
      ...ALL_RASTER_LAYERS.map((id): maplibregl.LayerSpecification => {
        const band = climbBand(id);
        return {
          id,
          type: "raster",
          source: id,
          ...(band
            ? {
                minzoom: band.from,
                maxzoom: band.to,
                paint: {
                  ...(id.startsWith("streets") ? STREETS_PAINT : {}),
                  // Each shows for a fraction of a second on the climb:
                  // MapLibre's 0.3 s fade-in per new tile left it mostly
                  // transparent, blur showing through.
                  "raster-fade-duration": 0,
                },
              }
            : id === "streets-detail"
              ? {
                  minzoom: DETAIL_ZOOM,
                  paint: {
                    ...STREETS_PAINT,
                    "raster-opacity": [
                      "interpolate",
                      ["linear"],
                      ["zoom"],
                      DETAIL_ZOOM,
                      0,
                      DETAIL_FULL_ZOOM,
                      1,
                    ],
                  },
                }
              : {
                  paint: {
                    ...(id.startsWith("streets") ? STREETS_PAINT : {}),
                    // Already in the browser cache (prefetchLowResTiles): no
                    // 0.3 s fade-in, during which the dark space colour showed
                    // through half the globe mid-flight.
                    ...(id.endsWith("-low")
                      ? { "raster-fade-duration": 0 }
                      : {}),
                  },
                }),
          layout: {
            visibility: BASE_LAYERS[styleMode].includes(id)
              ? "visible"
              : "none",
          },
        };
      }),
      ...ALL_NAME_LAYERS.map((layer) => ({
        ...layer,
        layout: {
          ...layer.layout,
          visibility: BASE_LAYERS[styleMode].includes(layer.id)
            ? ("visible" as const)
            : ("none" as const),
        },
      })),
    ],
  };
}

export default function TripMap({
  steps,
  activeStepId,
  isScrubbing = false,
  hidden = false,
  styleMode,
  showRoute,
  onSelectStep,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const heavenStep = steps.find(isHeaven);
  const isPetTrip = heavenStep != null;
  // The walking pet on a pet's trip (see walkPet), once the map has loaded.
  const petRef = useRef<maplibregl.Marker | null>(null);
  // The city the pet is in (or heading to), to tell a drive from a walk.
  const petCityRef = useRef<string | null>(null);
  // Read when the route layer is added on "style.load", which can come after the
  // visitor already toggled it.
  const showRouteRef = useRef(showRoute);
  // Read by the flight effect, which doesn't rerun on a style toggle.
  const styleModeRef = useRef(styleMode);
  // The active step's tile preloads, set by the flight effect and rerun in the
  // new style on a toggle: otherwise a visitor who switches on a step flies
  // to the next one with only the old style's tiles cached.
  const prefetchNearbyRef = useRef<(() => void) | null>(null);
  // Where HeavenScene sits (the globe's top edge), and whether it's showing.
  const [placement, setPlacement] = useState<{
    top: number;
    width: number;
  } | null>(null);
  // The heaven step whose camera flight has landed; it shows only while
  // still the active step.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const heavenShown = revealedId != null && revealedId === activeStepId;
  // Bumped to rebuild the map after a lost WebGL context (see below).
  const [generation, setGeneration] = useState(0);
  // Map setup — runs once (again only after a lost WebGL context).
  useEffect(() => {
    if (!containerRef.current || steps.length === 0) return;
    const markers = markersRef.current;

    // The active step, not just the first: the map remounts on the active
    // step after a location change (see TripView.tsx).
    const start = steps.find((s) => s.id === activeStepId) ?? steps[0]!;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(styleMode),
      center: [start.lng, start.lat],
      zoom: STEP_ZOOM,
      attributionControl: false,
      // `refreshExpiredTiles` stays on (the default): turning it off makes
      // MapLibre load tiles through <img> and decode them on the main
      // thread, which drops frames all through a flight. The cost is a
      // re-request when a tile's cache lifetime ends (12h Mapbox, 24h Esri
      // by their response headers, October 2026).
    });
    mapRef.current = map;

    if (isHeaven(start)) {
      map.jumpTo(heavenCamera(map, steps, start));
      map.once("load", () => {
        setPlacement(heavenPlacement(map));
        setRevealedId(start.id);
      });
    }

    // Mobile browsers can drop the WebGL context under memory pressure (e.g.
    // full-screen photos and video open on top). MapLibre waits for it to be
    // restored, which iOS doesn't always do — leaving a blank map behind the
    // text. Rebuild the map if it isn't back promptly.
    let contextTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("webglcontextlost", () => {
      contextTimer = setTimeout(() => setGeneration((g) => g + 1), 1000);
    });
    map.on("webglcontextrestored", () => clearTimeout(contextTimer));

    // Safety net: on some layout timings the container isn't at its final
    // size yet when MapLibre reads it at construction, and it doesn't
    // always recover on its own. A ResizeObserver catches the real size as
    // soon as layout settles.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    // "style.load", not "load": "load" waits for every tile on screen, which
    // held the pins back ~5 s on a cold visit (Chrome, 20 Mbps) while the
    // map itself drew at ~0.7 s.
    map.once("style.load", () => {
      const legs = buildRouteLegs(steps);
      const geojson = legsToGeoJSON(legs);

      map.addSource("route", { type: "geojson", data: geojson });
      if (isPetTrip) {
        map.addImage("paw", drawPaw(routeColorFor(styleMode)), {
          pixelRatio: 2,
        });
        map.addLayer({
          id: "route",
          type: "symbol",
          source: "route",
          layout: {
            visibility: showRouteRef.current ? "visible" : "none",
            "symbol-placement": "line",
            "symbol-spacing": 26,
            "icon-image": "paw",
            "icon-size": 0.7,
            // Toes point along the direction of travel.
            "icon-rotate": 90,
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 0.9 },
        });
      } else
        map.addLayer({
          // Ground and flight legs render identically (same dashed style
          // throughout the trip) — one layer, no filter needed.
          id: "route",
          type: "line",
          source: "route",
          layout: { visibility: showRouteRef.current ? "visible" : "none" },
          paint: {
            "line-color": routeColorFor(styleMode),
            "line-width": 4,
            "line-dasharray": [3, 3],
            "line-opacity": 0.9,
          },
        });

      for (const step of steps) {
        if (isHeaven(step)) continue; // shown above the globe instead
        const el = document.createElement("div");
        el.className = "trip-pin";

        const photo = document.createElement("div");
        photo.className = "trip-pin-photo";
        if (step.pinUrl) {
          const img = document.createElement("img");
          // Off-screen pins (most of them, on a long trip) wait until a
          // flight brings them near the view, instead of every thumbnail
          // loading with the page.
          img.loading = "lazy";
          img.src = step.pinUrl;
          img.alt = "";
          photo.appendChild(img);
        } else {
          const fallback = document.createElement("div");
          fallback.className = "trip-pin-fallback";
          photo.appendChild(fallback);
        }
        el.appendChild(photo);

        const label = document.createElement("span");
        label.className = "trip-pin-label";
        label.textContent = step.locationName;
        el.appendChild(label);

        el.addEventListener("click", () => onSelectStep(step.id));

        // Hidden, not MapLibre's default 20%, behind the globe: faded pins
        // there showed up in the space beside it mid-flight.
        const marker = new maplibregl.Marker({
          element: el,
          anchor: "center",
          opacityWhenCovered: 0,
        })
          .setLngLat([step.lng, step.lat])
          .addTo(map);
        markers.set(step.id, marker);
      }

      if (isPetTrip) {
        const el = document.createElement("div");
        el.className = "walking-pet";
        // Cartoons of the pet (public/pet/): standing, running (legs
        // animated) while it moves, and out the window of a car between
        // cities — .walking-pet-moving/-car show which.
        for (const name of ["walk", "run", "car"]) {
          const img = el.appendChild(document.createElement("img"));
          img.src = `/pet/${name}.svg`;
          img.alt = "";
          img.className = `walking-pet-${name}-img`;
        }
        el.classList.toggle("walking-pet-hidden", isHeaven(start));
        // Beside the pin's top-right, not over its photo.
        petRef.current = new maplibregl.Marker({
          element: el,
          offset: [26, -22],
          opacityWhenCovered: 0,
        })
          .setLngLat([start.lng, start.lat])
          .addTo(map);
      }

      // The highlight effect below runs on mount too, but markers don't
      // exist yet at that point (they're created here, once the map style
      // has finished loading) — apply the initial selection's highlight
      // once markers actually exist, or the default-active pin never gets
      // it until the visitor picks a different step.
      for (const [id, marker] of markers) {
        marker
          .getElement()
          .classList.toggle("trip-pin-active", id === activeStepId);
      }
    });

    return () => {
      clearTimeout(contextTimer);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      petRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map is built once from the initial steps
  }, [generation]);

  // Highlight the active pin and fly to it whenever selection changes.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker
        .getElement()
        .classList.toggle("trip-pin-active", id === activeStepId);
    }
    const map = mapRef.current;
    const step = steps.find((s) => s.id === activeStepId);
    if (!step || !map) return;
    // The visitor likely swipes on next: have its landing ready by then,
    // and the climb tiles at both ends of a long flight from here (either
    // way, for this step).
    const index = steps.indexOf(step);
    const next = steps[index + 1];
    const { clientWidth, clientHeight } = map.getContainer();
    const far = (n: MapStep | undefined): n is MapStep =>
      !!n && !isHeaven(n) && haversineKm(step, n) > LONG_FLIGHT_KM;
    prefetchNearbyRef.current = () => {
      const styleMode = styleModeRef.current;
      if (!isScrubbing && !isHeaven(step)) {
        if (far(steps[index - 1]) || far(next)) {
          prefetchClimb(styleMode, step, clientWidth, clientHeight);
        }
        if (far(next)) {
          prefetchClimb(styleMode, next, clientWidth, clientHeight);
        }
      }
      if (next && !isHeaven(next) && !isScrubbing) {
        prefetchLanding(styleMode, next, clientWidth, clientHeight);
      }
    };
    prefetchNearbyRef.current();
    const pet = petRef.current;
    pet?.getElement().classList.toggle("walking-pet-hidden", isHeaven(step));
    // Reduced motion: the camera (and the pet) cut straight to each step
    // instead of flying there.
    const still = hidden || prefersReducedMotion();

    if (isHeaven(step)) {
      // Rise to the globe, then fade HeavenScene in on its top edge.
      const camera = heavenCamera(map, steps, step);
      const reveal = () => {
        // Only once the camera is actually up at the globe: a move this
        // flight cut off also ends with a "moveend", down at street level.
        if (Math.abs(map.getZoom() - camera.zoom!) > 0.05) return;
        setPlacement(heavenPlacement(map));
        setRevealedId(step.id);
      };
      // Every time the camera settles here, not just after this flight:
      // the flight can be interrupted or replaced (e.g. by the story view
      // jumping the hidden map), and the visitor can drag the globe.
      map.on("moveend", reveal);
      if (still || isScrubbing) map.jumpTo(camera);
      else map.flyTo({ ...camera, duration: HEAVEN_FLIGHT_MS });
      return () => {
        map.off("moveend", reveal);
      };
    }

    // Leaving heaven: its scene (no longer the active step's) is fading
    // out — the camera waits for that before heading back down.
    const leavingHeaven = revealedId != null && !still && !isScrubbing;
    const hideHeaven = () => setRevealedId(null);
    map.once("movestart", hideHeaven);
    let flightTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWalk: (() => void) | undefined;
    const showNames = () => setNamesShown(map, true);
    // Detail back once the camera starts down (its zoom rising again).
    let lowestZoom = Infinity;
    const showDetailOnDescent = () => {
      const zoom = map.getZoom();
      lowestZoom = Math.min(lowestZoom, zoom);
      if (zoom < lowestZoom + 0.05) return;
      map.off("zoom", showDetailOnDescent);
      setDetailShown(map, true);
    };

    const drive = petCityRef.current !== step.cityName;
    petCityRef.current = step.cityName;
    if (still || isScrubbing || leavingHeaven) {
      pet?.setLngLat([step.lng, step.lat]);
    }
    if (still) {
      // Nobody can see a flight — jump straight there, loading only the
      // destination's tiles (ready for when the map shows again) instead of
      // every zoom level along the way.
      map.jumpTo({
        center: [step.lng, step.lat],
        zoom: STEP_ZOOM,
        padding: NO_PADDING,
      });
    } else if (isScrubbing) {
      // Short, cheap pan while dragging — a full flyTo per step would
      // fight itself and load far more tiles than a fast drag needs.
      map.easeTo({
        center: [step.lng, step.lat],
        duration: 250,
        padding: NO_PADDING,
      });
    } else if (leavingHeaven) {
      flightTimer = setTimeout(
        () =>
          map.flyTo({
            center: [step.lng, step.lat],
            zoom: STEP_ZOOM,
            duration: HEAVEN_FLIGHT_MS,
            padding: NO_PADDING,
          }),
        HEAVEN_GONE_MS,
      );
    } else {
      // Longer for a flight-scale hop (e.g. between countries), so the
      // pull-back over the globe doesn't race by (LONG_FLIGHT_EASING).
      const { lat, lng } = map.getCenter();
      const far = haversineKm({ lat, lng }, step) > LONG_FLIGHT_KM;
      map.flyTo({
        center: [step.lng, step.lat],
        zoom: STEP_ZOOM,
        ...(far
          ? { duration: LONG_FLIGHT_MS, easing: LONG_FLIGHT_EASING }
          : { duration: 2500 }),
        padding: NO_PADDING,
      });
      // Names fade out for the climb and back in on landing: leaving a
      // city, its towns' names flashed up for a moment as the camera rose
      // through their zooms. After flyTo, as an interrupted flight's
      // "moveend" (fired by flyTo) shows them again.
      if (far) {
        setNamesShown(map, false);
        map.once("moveend", showNames);
        setDetailShown(map, false);
        map.on("zoom", showDetailOnDescent);
      }
      // After flyTo, not before: cutting short a flight still in the air
      // fires its "moveend" right away, which would end this walk at once.
      // The new flight's first move comes on the next frame.
      if (pet) stopWalk = walkPet(map, pet, step, drive);
    }
    return () => {
      clearTimeout(flightTimer);
      stopWalk?.();
      map.off("movestart", hideHeaven);
      map.off("moveend", showNames);
      showNames();
      map.off("zoom", showDetailOnDescent);
      setDetailShown(map, true);
    };
    // `hidden` is read, not a dependency: showing the map again shouldn't
    // re-fly to the step it's already on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepId, steps, isScrubbing, generation]);

  // The story view closing on a heaven step: settle the camera on the globe
  // again, which (via the "moveend" listener above) places and shows the
  // scene for the map as it now is.
  const wasHidden = useRef(hidden);
  useEffect(() => {
    const map = mapRef.current;
    const step = steps.find((s) => s.id === activeStepId);
    if (wasHidden.current && !hidden && map && step && isHeaven(step)) {
      map.jumpTo(heavenCamera(map, steps, step));
    }
    wasHidden.current = hidden;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the story closing only
  }, [hidden]);

  // Keep HeavenScene on the globe's edge while the visitor drags or zooms it.
  useEffect(() => {
    const map = mapRef.current;
    if (!heavenShown || !map) return;
    let raf = 0;
    const follow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPlacement(heavenPlacement(map)));
    };
    map.on("move", follow);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", follow);
    };
  }, [heavenShown, generation]);

  useEffect(() => {
    showRouteRef.current = showRoute;
    const map = mapRef.current;
    if (map?.getLayer("route")) {
      map.setLayoutProperty(
        "route",
        "visibility",
        showRoute ? "visible" : "none",
      );
    }
  }, [showRoute]);

  // Flip the visible base layer. Before the style is parsed the layers don't
  // exist yet, so a toggle that early waits for "style.load" (registered
  // after the setup effect's, so the route exists by then). Was skipped
  // until every tile had loaded (isStyleLoaded()): a tap in the first
  // seconds changed the button but left the map on the old style.
  useEffect(() => {
    styleModeRef.current = styleMode;
    prefetchLowResTiles(styleMode);
    prefetchNearbyRef.current?.();
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const id of ALL_BASE_LAYERS) {
        map.setLayoutProperty(
          id,
          "visibility",
          BASE_LAYERS[styleMode].includes(id) ? "visible" : "none",
        );
      }
      if (isPetTrip) {
        if (map.hasImage("paw")) {
          map.updateImage("paw", drawPaw(routeColorFor(styleMode)));
        }
      } else if (map.getLayer("route")) {
        map.setPaintProperty("route", "line-color", routeColorFor(styleMode));
      }
    };
    if (map.getLayer(ALL_BASE_LAYERS[0]!)) apply();
    else map.once("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [styleMode, isPetTrip]);

  return (
    // MapLibre mutates the element it's given (adds its own .maplibregl-map
    // class, whose stylesheet sets position:relative) — an outer wrapper
    // keeps our absolute/inset-0 sizing from being overridden by that.
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
      {heavenStep && placement && (
        <HeavenScene
          visible={heavenShown}
          globeTop={placement.top}
          width={placement.width}
          photoUrl={heavenStep.thumbUrl}
          label={heavenStep.locationName}
          onSelect={() => onSelectStep(heavenStep.id)}
        />
      )}
    </div>
  );
}
