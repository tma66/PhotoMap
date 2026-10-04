"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import { buildRouteLegs, legsToGeoJSON, type RouteStep } from "@/lib/route";
import { haversineKm } from "@/lib/geo";
import { isHeaven } from "@/lib/heaven";
import HeavenScene from "./HeavenScene";
import {
  GLOBE_SKY,
  labelsSource,
  satelliteSource,
  streetsSource,
} from "@/lib/map-style";

export interface MapStep extends RouteStep {
  locationName: string;
  thumbUrl: string | null;
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

// Raster layers shown per style, bottom to top. The satellite labels overlay
// isn't needed on streets, whose tiles carry their own labels.
const BASE_LAYERS: Record<MapStyleMode, string[]> = {
  satellite: ["satellite-low", "satellite", "labels"],
  streets: ["streets-low", "streets"],
};
const ALL_BASE_LAYERS = [
  "satellite-low",
  "streets-low",
  "satellite",
  "streets",
  "labels",
];

const LOW_RES_SOURCES: Record<
  MapStyleMode,
  () => maplibregl.RasterSourceSpecification
> = {
  satellite: satelliteSource,
  streets: streetsSource,
};

// Warms the browser cache with every low-res underlay tile (21 in total for
// zooms 0–2) so the first long flight doesn't wait on them mid-air and show
// dark holes. MapLibre requests the same URLs later and gets cache hits.
// Once per style per page load — later trip pages reuse the same tiles.
const prefetchedStyles = new Set<MapStyleMode>();
function prefetchLowResTiles(styleMode: MapStyleMode): void {
  const template = LOW_RES_SOURCES[styleMode]().tiles?.[0];
  if (!template || prefetchedStyles.has(styleMode)) return;
  prefetchedStyles.add(styleMode);
  for (let z = 0; z <= LOW_RES_MAX_ZOOM; z++) {
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++) {
        const url = template
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
        fetch(url).catch(() => {});
      }
    }
  }
}

// Satellite and streets are both always in the style; the toggle just flips
// which raster layer is visible (see the styleMode effect below) instead of
// swapping maplibregl.Map's style wholesale, which would also wipe and
// require re-adding the route/pin layers added after "load".
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
    sources: {
      satellite: satelliteSource(),
      streets: streetsSource(),
      labels: labelsSource(),
      // Same imagery capped at zoom 2 (16 tiles for the whole world), drawn
      // underneath — mid-flight, any detailed tile that hasn't arrived yet
      // shows a blurry version of the same map instead of a dark hole.
      "satellite-low": { ...satelliteSource(), maxzoom: LOW_RES_MAX_ZOOM },
      "streets-low": { ...streetsSource(), maxzoom: LOW_RES_MAX_ZOOM },
    },
    layers: [
      {
        id: "space",
        type: "background",
        paint: { "background-color": "#04101c" },
      },
      ...ALL_BASE_LAYERS.map(
        (id): maplibregl.LayerSpecification => ({
          id,
          type: "raster",
          source: id,
          layout: {
            visibility: BASE_LAYERS[styleMode].includes(id)
              ? "visible"
              : "none",
          },
        }),
      ),
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
  // Read when the route layer is added on "load", which can come after the
  // visitor already toggled it.
  const showRouteRef = useRef(showRoute);
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
      zoom: 13,
      attributionControl: false,
      // Imagery doesn't change while a page is open — don't re-request
      // tiles just because their cache lifetime ran out.
      refreshExpiredTiles: false,
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

    map.on("load", () => {
      const legs = buildRouteLegs(steps);
      const geojson = legsToGeoJSON(legs);

      map.addSource("route", { type: "geojson", data: geojson });
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
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.9,
        },
      });

      for (const step of steps) {
        if (isHeaven(step)) continue; // shown above the globe instead
        const el = document.createElement("div");
        el.className = "trip-pin";

        const photo = document.createElement("div");
        photo.className = "trip-pin-photo";
        if (step.thumbUrl) {
          const img = document.createElement("img");
          img.src = step.thumbUrl;
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

        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([step.lng, step.lat])
          .addTo(map);
        markers.set(step.id, marker);
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

    if (isHeaven(step)) {
      // Rise to the globe, then fade HeavenScene in on its top edge.
      const camera = heavenCamera(map, steps, step);
      const reveal = () => {
        setPlacement(heavenPlacement(map));
        setRevealedId(step.id);
      };
      // Every time the camera settles here, not just after this flight:
      // the flight can be interrupted or replaced (e.g. by the story view
      // jumping the hidden map), and the visitor can drag the globe.
      map.on("moveend", reveal);
      if (hidden || isScrubbing) map.jumpTo(camera);
      else map.flyTo({ ...camera, duration: HEAVEN_FLIGHT_MS });
      return () => {
        map.off("moveend", reveal);
      };
    }

    // Leaving heaven: its scene (no longer the active step's) is fading
    // out — the camera waits for that before heading back down.
    const leavingHeaven = revealedId != null && !hidden && !isScrubbing;
    const hideHeaven = () => setRevealedId(null);
    map.once("movestart", hideHeaven);
    let flightTimer: ReturnType<typeof setTimeout> | undefined;

    if (hidden) {
      // Nobody can see a flight — jump straight there, loading only the
      // destination's tiles (ready for when the map shows again) instead of
      // every zoom level along the way.
      map.jumpTo({
        center: [step.lng, step.lat],
        zoom: 13,
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
            zoom: 13,
            duration: HEAVEN_FLIGHT_MS,
            padding: NO_PADDING,
          }),
        HEAVEN_GONE_MS,
      );
    } else {
      // Twice as long for a flight-scale hop (e.g. between countries), so
      // the pull-back over the globe doesn't race by.
      const { lat, lng } = map.getCenter();
      const far = haversineKm({ lat, lng }, step) > LONG_FLIGHT_KM;
      map.flyTo({
        center: [step.lng, step.lat],
        zoom: 13,
        duration: far ? 5000 : 2500,
        padding: NO_PADDING,
      });
    }
    return () => {
      clearTimeout(flightTimer);
      map.off("movestart", hideHeaven);
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

  // Flip the visible base layer. Guarded on isStyleLoaded() since this can
  // fire before the map's initial style finishes loading, when the layers
  // don't exist to set properties on yet — harmless to skip, since the
  // style was already built with the right layer visible for that case.
  useEffect(() => {
    prefetchLowResTiles(styleMode);
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    for (const id of ALL_BASE_LAYERS) {
      map.setLayoutProperty(
        id,
        "visibility",
        BASE_LAYERS[styleMode].includes(id) ? "visible" : "none",
      );
    }
    if (map.getLayer("route")) {
      map.setPaintProperty("route", "line-color", routeColorFor(styleMode));
    }
  }, [styleMode]);

  const heavenStep = steps.find(isHeaven);

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
