"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import { labelsSource, satelliteSource, streetsSource } from "@/lib/map-style";
import type { MapStyleMode } from "./TripMap";
import { BackChevronIcon } from "./icons";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface SearchResult {
  id: string;
  name: string;
  context: string;
  lng: number;
  lat: number;
}

/** Mapbox Search Box text search (places, addresses and landmarks — the
 * plain Geocoding API has no landmarks), biased toward `near`. Only used to
 * jump the map somewhere — what gets saved is wherever the pin is left. */
async function searchPlaces(
  q: string,
  near: { lat: number; lng: number },
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("proximity", `${near.lng},${near.lat}`);
  url.searchParams.set("access_token", MAPBOX_TOKEN!);
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features: {
      id: string;
      geometry: { coordinates: [number, number] };
      properties: { name: string; place_formatted?: string };
    }[];
  };
  return data.features.map((f) => ({
    id: f.id,
    name: f.properties.name,
    context: f.properties.place_formatted ?? "",
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));
}

function pickerStyle(styleMode: MapStyleMode): maplibregl.StyleSpecification {
  return styleMode === "streets"
    ? {
        version: 8,
        sources: { streets: streetsSource() },
        layers: [{ id: "streets", type: "raster", source: "streets" }],
      }
    : {
        version: 8,
        sources: { satellite: satelliteSource(), labels: labelsSource() },
        layers: [
          { id: "satellite", type: "raster", source: "satellite" },
          { id: "labels", type: "raster", source: "labels" },
        ],
      };
}

/**
 * Full-screen "change this step's location" picker: the pin stays fixed in
 * the middle and the visitor moves the map under it (or jumps there via
 * search), then confirms. Saving moves every photo in the step to that spot
 * in trip.json and re-ingests the trip — see /api/step-location.
 */
export default function LocationPicker({
  step,
  photoCount,
  styleMode,
  onClose,
  onSaved,
}: {
  step: { id: string; lat: number; lng: number; locationName: string };
  photoCount: number;
  styleMode: MapStyleMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: pickerStyle(styleMode),
      center: [step.lng, step.lat],
      zoom: 14,
      attributionControl: false,
    });
    mapRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- built once per open
  }, []);

  // Debounced: every request counts against the Mapbox free tier.
  useEffect(() => {
    if (!MAPBOX_TOKEN || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(query.trim(), step, controller.signal)
        .then(setResults)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, step]);

  const choose = (r: SearchResult) => {
    setQuery(r.name);
    setResults([]);
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 15 });
  };

  const save = async () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/step-location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stepId: step.id,
          lat: center.lat,
          lng: center.wrap().lng,
        }),
      });
      if (res.status === 404) {
        // The trip was re-ingested since this page loaded (new step ids).
        setError(
          "This trip has changed since you opened it. Reload the page and try again.",
        );
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      onSaved();
    } catch {
      setError("Couldn't save the new location. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ps-navy">
      {/* Wrapped: MapLibre's CSS sets position: relative on the container
          itself, which would cancel `absolute inset-0`. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Fixed center pin: its tip marks the spot that gets saved. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <svg width="40" height="52" viewBox="0 0 40 52">
          <path
            d="M20 51C20 51 38 32 38 19A18 18 0 0 0 2 19C2 32 20 51 20 51Z"
            fill="#0099E5"
            stroke="#fff"
            strokeWidth="2.5"
          />
          <circle cx="20" cy="19" r="6.5" fill="#fff" />
        </svg>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40" />

      <div className="absolute top-0 inset-x-0 safe-top px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cancel"
            className="shrink-0 w-12 h-12 rounded-full map-icon-button flex items-center justify-center shadow-soft"
          >
            <BackChevronIcon size={28} color="#ffffff" />
          </button>
          {MAPBOX_TOKEN && (
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim().length < 2) setResults([]);
              }}
              placeholder="Search for a place"
              enterKeyHint="search"
              className="flex-1 min-w-0 h-12 rounded-full bg-white px-5 text-base text-ps-navy-text shadow-soft outline-none placeholder:text-ps-muted-2"
            />
          )}
        </div>
        {results.length > 0 && (
          <ul className="mt-2 ml-14 rounded-2xl bg-white shadow-soft overflow-hidden">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="w-full text-left px-4 py-3 border-b border-ps-border/40 last:border-0 active:bg-ps-bg"
                >
                  <p className="text-sm font-semibold text-ps-navy-text">
                    {r.name}
                  </p>
                  {r.context && (
                    <p className="text-xs text-ps-muted">{r.context}</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 rounded-t-3xl bg-white px-5 pt-5 safe-bottom shadow-soft">
        <p className="text-ps-navy-text font-bold text-lg">Change location</p>
        <p className="text-ps-muted text-sm mt-1">
          Move the map to put the pin on the right spot. This moves{" "}
          {photoCount === 1 ? "the photo" : `all ${photoCount} photos`} in{" "}
          <span className="font-semibold">{step.locationName}</span>.
        </p>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 mb-1 w-full h-12 rounded-full bg-ps-link text-white font-semibold disabled:opacity-60"
        >
          {saving ? "Saving…" : "Select this location"}
        </button>
      </div>
    </div>
  );
}
