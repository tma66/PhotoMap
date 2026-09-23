"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";

export interface GlobeStep {
  id: string;
  lat: number;
  lng: number;
  thumbUrl: string | null;
  tripId: string;
  order: number;
}

interface GlobeMapProps {
  steps: GlobeStep[];
  visitedCountryCodes?: string[];
  onSelectStep?: (tripId: string) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

function darkStyle(): maplibregl.StyleSpecification {
  const tiles = MAPBOX_TOKEN
    ? [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png90?access_token=${MAPBOX_TOKEN}`,
      ]
    : [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ];
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      satellite: { type: "raster", tiles, tileSize: 256, maxzoom: 19 },
    },
    layers: [
      {
        id: "bg",
        type: "background",
        paint: { "background-color": "#04101c" },
      },
      {
        id: "satellite",
        type: "raster",
        source: "satellite",
        paint: { "raster-opacity": 0.9 },
      },
    ],
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
  } as unknown as maplibregl.StyleSpecification;
}

export default function GlobeMap({ steps, onSelectStep }: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rotateRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: darkStyle(),
      center: steps[0] ? [steps[0].lng, steps[0].lat] : [10, 20],
      zoom: 1.4,
      attributionControl: false,
      dragRotate: false,
    });

    // See TripMap.tsx for why this is needed: without it the map can stall
    // permanently at whatever size it read at construction time.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    map.on("load", () => {
      const bySteps = new Map<string, GlobeStep[]>();
      for (const s of steps) {
        const arr = bySteps.get(s.tripId) ?? [];
        arr.push(s);
        bySteps.set(s.tripId, arr);
      }

      const lineFeatures: GeoJSON.Feature[] = [...bySteps.values()].map(
        (tripSteps) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: tripSteps
              .sort((a, b) => a.order - b.order)
              .map((s) => [s.lng, s.lat]),
          },
        }),
      );

      map.addSource("globe-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: lineFeatures },
      });
      map.addLayer({
        id: "globe-routes-line",
        type: "line",
        source: "globe-routes",
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.2,
          "line-opacity": 0.7,
        },
      });

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

    // Slow auto-rotate, until the visitor drags/taps the globe.
    let lng = 0;
    const tick = () => {
      lng += 0.05;
      map.easeTo({ center: [lng, map.getCenter().lat], duration: 0 });
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
