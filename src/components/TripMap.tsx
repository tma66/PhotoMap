"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import {
  buildRouteLegs,
  legsToGeoJSON,
  type RouteStep,
  type RouteTrackPoint,
} from "@/lib/route";
import { labelsSource, satelliteSource, streetsSource } from "@/lib/map-style";

export interface MapStep extends RouteStep {
  thumbUrl: string | null;
}

export type MapStyleMode = "satellite" | "streets";

interface TripMapProps {
  steps: MapStep[];
  trackPoints: RouteTrackPoint[];
  activeStepId: string | null;
  isScrubbing?: boolean;
  styleMode: MapStyleMode;
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
function prefetchLowResTiles(styleMode: MapStyleMode): void {
  const template = LOW_RES_SOURCES[styleMode]().tiles?.[0];
  if (!template) return;
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
    sky: {
      "atmosphere-blend": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        1,
        5,
        1,
        7,
        0,
      ],
    },
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
  trackPoints,
  activeStepId,
  isScrubbing = false,
  styleMode,
  onSelectStep,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Map setup — runs once.
  useEffect(() => {
    if (!containerRef.current || steps.length === 0) return;
    const markers = markersRef.current;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(styleMode),
      center: [steps[0]!.lng, steps[0]!.lat],
      zoom: 13,
      attributionControl: false,
    });
    mapRef.current = map;

    // Safety net: on some layout timings the container isn't at its final
    // size yet when MapLibre reads it at construction, and it doesn't
    // always recover on its own. A ResizeObserver catches the real size as
    // soon as layout settles.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      const legs = buildRouteLegs(steps, trackPoints);
      const geojson = legsToGeoJSON(legs);

      map.addSource("route", { type: "geojson", data: geojson });
      map.addLayer({
        // Ground and flight legs render identically (same dashed style
        // throughout the trip) — one layer, no filter needed.
        id: "route",
        type: "line",
        source: "route",
        paint: {
          "line-color": routeColorFor(styleMode),
          "line-width": 4,
          "line-dasharray": [1.5, 1.5],
          "line-opacity": 0.9,
        },
      });

      for (const step of steps) {
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
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map is built once from the initial steps/trackPoints
  }, []);

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

    if (isScrubbing) {
      // Short, cheap pan while dragging — a full flyTo per step would
      // fight itself and load far more tiles than a fast drag needs.
      map.easeTo({ center: [step.lng, step.lat], duration: 250 });
    } else {
      map.flyTo({ center: [step.lng, step.lat], zoom: 13, duration: 2500 });
    }
  }, [activeStepId, steps, isScrubbing]);

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

  return (
    // MapLibre mutates the element it's given (adds its own .maplibregl-map
    // class, whose stylesheet sets position:relative) — an outer wrapper
    // keeps our absolute/inset-0 sizing from being overridden by that.
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
