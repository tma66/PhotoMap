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

export interface MapStep extends RouteStep {
  thumbUrl: string | null;
}

interface TripMapProps {
  steps: MapStep[];
  trackPoints: RouteTrackPoint[];
  activeStepId: string | null;
  onSelectStep: (id: string) => void;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

function satelliteStyle(): maplibregl.StyleSpecification {
  const tiles = MAPBOX_TOKEN
    ? [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.png90?access_token=${MAPBOX_TOKEN}`,
      ]
    : [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ];

  return {
    version: 8,
    sources: {
      satellite: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution: MAPBOX_TOKEN ? "© Mapbox" : "© Esri",
        maxzoom: 19,
      },
    },
    layers: [{ id: "satellite", type: "raster", source: "satellite" }],
  };
}

export default function TripMap({
  steps,
  trackPoints,
  activeStepId,
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
      style: satelliteStyle(),
      center: [steps[0]!.lng, steps[0]!.lat],
      zoom: 4,
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
        id: "route-ground",
        type: "line",
        source: "route",
        filter: ["==", ["get", "isFlight"], false],
        paint: {
          "line-color": "#ffffff",
          "line-width": 2.5,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "route-flight",
        type: "line",
        source: "route",
        filter: ["==", ["get", "isFlight"], true],
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-dasharray": [0.2, 1.6],
          "line-opacity": 0.9,
        },
      });

      const bounds = new maplibregl.LngLatBounds();
      for (const s of steps) bounds.extend([s.lng, s.lat]);
      map.fitBounds(bounds, { padding: 60, duration: 0 });

      for (const step of steps) {
        const el = document.createElement("div");
        el.className = "trip-pin";
        el.innerHTML = step.thumbUrl
          ? `<img src="${step.thumbUrl}" alt="" />`
          : `<div class="trip-pin-fallback"></div>`;
        el.addEventListener("click", () => onSelectStep(step.id));

        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([step.lng, step.lat])
          .addTo(map);
        markers.set(step.id, marker);
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
    const step = steps.find((s) => s.id === activeStepId);
    if (step && mapRef.current) {
      mapRef.current.flyTo({
        center: [step.lng, step.lat],
        zoom: 11,
        duration: 800,
      });
    }
  }, [activeStepId, steps]);

  return (
    // MapLibre mutates the element it's given (adds its own .maplibregl-map
    // class, whose stylesheet sets position:relative) — an outer wrapper
    // keeps our absolute/inset-0 sizing from being overridden by that.
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
