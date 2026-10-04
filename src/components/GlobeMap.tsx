"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import type { HomeGlobeStep } from "@/lib/home-view";
import { GLOBE_SKY, labelsSource, satelliteSource } from "@/lib/map-style";

interface GlobeMapProps {
  steps: HomeGlobeStep[];
  onSelectStep?: (tripId: string) => void;
  /** Pixels of the container's bottom edge covered by an overlay (e.g. the
   * peeked bottom sheet) — the globe recenters within the space above it
   * instead of the full container, so it doesn't render half-hidden behind
   * the overlay with empty sky above. */
  bottomInset?: number;
  /** Stops the auto-rotate loop — e.g. while a fully-expanded sheet covers
   * the globe entirely, so nothing can see it rotate anyway. */
  paused?: boolean;
}

// A small tileable dot pattern used as the globe's "bg" layer fill, instead
// of a flat color — the background layer covers the whole canvas (both the
// deep-space area around the sphere and any of the sphere itself not
// covered by opaque imagery), so this is the only reliable way to put stars
// there: a plain CSS starfield behind the canvas would never show through
// the background layer's own opaque paint.
function starfieldPattern(): ImageData {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#04101c";
  ctx.fillRect(0, 0, size, size);
  // A fixed seed so the pattern is stable across mounts instead of
  // reshuffling every time the globe remounts.
  let seed = 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 140; i++) {
    ctx.globalAlpha = rand() * 0.6 + 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, rand() * 1.1 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, size, size);
}

// MapLibre's zoom↔world-size relationship is defined relative to a fixed
// 512px reference tile regardless of any raster source's own tileSize. The
// globe's rendered diameter (px) at a given zoom follows worldSize/π (its
// rendered circumference divided by π) — inverting that gives the zoom
// that fits a target diameter, used below to keep the globe from poking
// above the visible area on short or narrow screens.
const GLOBE_REFERENCE_TILE_PX = 512;
function zoomForGlobeDiameter(diameterPx: number): number {
  return Math.log2((diameterPx * Math.PI) / GLOBE_REFERENCE_TILE_PX);
}

function darkStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      satellite: satelliteSource(),
      labels: labelsSource(),
    },
    layers: [
      {
        id: "bg",
        type: "background",
        // Solid color to start — the starfield pattern is swapped in via
        // setPaintProperty once map.addImage has actually registered it
        // (see the "load" handler below). Referencing "background-pattern"
        // in the initial style before the image exists silently breaks the
        // whole style load (no "load" event, no tiles, no markers).
        paint: { "background-color": "#04101c" },
      },
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: { "raster-opacity": 0.9 },
      },
      {
        id: "labels",
        type: "raster",
        source: "labels",
        paint: { "raster-opacity": 0.9 },
      },
    ],
    sky: GLOBE_SKY,
  };
}

export default function GlobeMap({
  steps,
  onSelectStep,
  bottomInset = 0,
  paused = false,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rotateRef = useRef<number | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Padding (below) shifts the globe's vertical center up to
    // (height-bottomInset)/2, so its radius must not exceed that or the top
    // pokes above the viewport — fit to the tighter of the container's
    // width and this available height, instead of a fixed zoom that clips
    // on short or narrow screens.
    const availableHeight = container.clientHeight - bottomInset;
    const fitDiameter = Math.min(container.clientWidth, availableHeight);
    const zoom = zoomForGlobeDiameter(fitDiameter);

    const map = new maplibregl.Map({
      container,
      style: darkStyle(),
      center: steps[0] ? [steps[0].lng, steps[0].lat] : [10, 20],
      zoom,
      attributionControl: false,
      dragRotate: false,
      refreshExpiredTiles: false, // see TripMap.tsx
    });
    // Padding isn't a constructor option — apply it via jumpTo so the globe
    // recenters within the space above the peeked drawer, not the full
    // container, before the first paint.
    map.jumpTo({ padding: { top: 0, bottom: bottomInset, left: 0, right: 0 } });

    // See TripMap.tsx for why this is needed: without it the map can stall
    // permanently at whatever size it read at construction time.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("load", () => {
      map.addImage("starfield", starfieldPattern());
      map.setPaintProperty("bg", "background-pattern", "starfield");

      for (const step of steps) {
        const el = document.createElement("div");
        el.className = "globe-pin";
        el.innerHTML = step.thumbUrl
          ? `<img src="${step.thumbUrl}" alt="" />`
          : "";
        if (onSelectStep) {
          el.style.cursor = "pointer";
          el.addEventListener("click", () => onSelectStep(step.tripId));
        }
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([step.lng, step.lat])
          .addTo(map);
      }
    });

    // Slow auto-rotate, until the visitor drags/taps the globe — advances by
    // elapsed wall-clock time (not a fixed per-frame step) so the speed
    // doesn't vary with the display's refresh rate. Skips the camera update
    // (and the marker-repositioning "move" event it triggers) while
    // `pausedRef` is set, e.g. a fully-expanded sheet covers the globe.
    const DEG_PER_SEC = 3;
    // jumpTo makes MapLibre re-evaluate which tiles the globe's horizon
    // needs, and doing that on every animation frame (~60Hz) was observed
    // (via the network panel) to occasionally re-fetch the same horizon
    // tile within a single second, presumably from it flickering in and out
    // of the "needed" set across consecutive, near-identical frames. 3°/sec
    // is slow enough that only actually moving the camera a few times a
    // second reads as exactly the same smooth rotation, while cutting how
    // often that recomputation — and any resulting duplicate tile fetch —
    // runs by roughly 5x.
    const ROTATE_UPDATE_MS = 80;
    let lng = 0;
    let lastTime: number | null = null;
    let lastUpdateTime: number | null = null;
    const tick = (now: number) => {
      if (!pausedRef.current) {
        const deltaMs = lastTime != null ? now - lastTime : 0;
        lng += DEG_PER_SEC * (deltaMs / 1000);
        if (
          lastUpdateTime == null ||
          now - lastUpdateTime >= ROTATE_UPDATE_MS
        ) {
          map.jumpTo({ center: [lng, map.getCenter().lat] });
          lastUpdateTime = now;
        }
      }
      lastTime = now;
      rotateRef.current = requestAnimationFrame(tick);
    };
    const stopRotation = () => {
      if (rotateRef.current != null) cancelAnimationFrame(rotateRef.current);
      rotateRef.current = null;
    };
    map.on("load", () => {
      rotateRef.current = requestAnimationFrame(tick);
    });
    map
      .getCanvas()
      .addEventListener("pointerdown", stopRotation, { once: true });

    return () => {
      stopRotation();
      resizeObserver.disconnect();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once from initial steps
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
