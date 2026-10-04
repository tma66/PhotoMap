// Fully offline reverse geocoding: which country is this point in, and
// what's the nearest named place — no network calls, no API key.
//
// Country: point-in-polygon against @geo-maps/countries-land-10km (OSM-derived
// 10km-resolution borders, features carry an ISO 3166-1 alpha-3 "A3" code).
// Place name: nearest entry in `all-the-cities` (GeoNames-derived, ~138k
// places with population >= 1000).
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { buffer } from "@turf/buffer";
// @ts-expect-error -- no bundled type declarations for this data package
import loadCountriesLand from "@geo-maps/countries-land-10km";
// @ts-expect-error -- no bundled type declarations for this data package
import allTheCities from "all-the-cities";
import { haversineKm, type LatLng } from "../lib/geo";
import { alpha3ToAlpha2 } from "../lib/countries";

interface CountryFeature {
  type: "Feature";
  properties: { A3: string };
  geometry: GeoJSON.Geometry;
}

// The package's default export is an async factory (it lazily decodes its
// bundled GeoJSON), not the data itself — top-level await loads it once.
const countriesLandData = (await loadCountriesLand()) as {
  features: CountryFeature[];
};
const countryFeatures = countriesLandData.features;

interface CityRecord {
  name: string;
  country: string;
  population: number;
  loc: { coordinates: [number, number] }; // [lng, lat]
}

const cities = allTheCities as CityRecord[];

// Only bother testing polygons whose rough bbox could contain the point.
const featureBounds = countryFeatures.map((f) => ({
  feature: f,
  bbox: geometryBbox(f.geometry),
}));

function geometryBbox(
  geom: GeoJSON.Geometry,
): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const walk = (coords: unknown): void => {
    const arr = coords as unknown[];
    if (typeof arr[0] === "number") {
      const [x, y] = arr as [number, number];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      (coords as unknown[]).forEach(walk);
    }
  };
  walk((geom as { coordinates: unknown }).coordinates);
  return [minX, minY, maxX, maxY];
}

// Small islands/atolls are often missing from this dataset's 10km-resolution
// land polygons even though they're clearly inhabited land — e.g. Laamu
// Atoll, Maldives. Within this radius of a known named place, attribute the
// point to that place's country rather than reporting open ocean.
const NEAR_LAND_FALLBACK_KM = 50;

// The same 10km resolution also clips real coastal land off a country's
// polygon entirely — e.g. Singapore's Changi Airport, built substantially on
// reclaimed land jutting into the strait. A point there fails every exact
// point-in-polygon test, and previously fell straight through to the
// nearest-named-place fallback below, which can jump across a narrow strait
// to a closer city in the WRONG country (Changi resolved to a town in
// Malaysia). Before that global fallback, retry with each nearby country's
// polygon grown by a couple of km — enough to catch land the raw polygon
// missed at the coast, not enough to bridge a real international strait.
const NEAR_COAST_BBOX_MARGIN_DEG = 0.1; // ~11km — cheap pre-filter only
const NEAR_COAST_BUFFER_KM = 4;

/** ISO 3166-1 alpha-2 country code for a coordinate, or undefined over open ocean. */
export function countryCodeForPoint(point: LatLng): string | undefined {
  const pt: GeoJSON.Feature<GeoJSON.Point> = {
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
  };

  for (const { feature, bbox } of featureBounds) {
    const [minX, minY, maxX, maxY] = bbox;
    if (
      point.lng < minX ||
      point.lng > maxX ||
      point.lat < minY ||
      point.lat > maxY
    ) {
      continue;
    }
    if (
      booleanPointInPolygon(
        pt,
        feature as unknown as GeoJSON.Feature<
          GeoJSON.Polygon | GeoJSON.MultiPolygon
        >,
      )
    ) {
      return alpha3ToAlpha2(feature.properties.A3);
    }
  }

  for (const { feature, bbox } of featureBounds) {
    const [minX, minY, maxX, maxY] = bbox;
    if (
      point.lng < minX - NEAR_COAST_BBOX_MARGIN_DEG ||
      point.lng > maxX + NEAR_COAST_BBOX_MARGIN_DEG ||
      point.lat < minY - NEAR_COAST_BBOX_MARGIN_DEG ||
      point.lat > maxY + NEAR_COAST_BBOX_MARGIN_DEG
    ) {
      continue;
    }
    const grown = buffer(feature as GeoJSON.Feature, NEAR_COAST_BUFFER_KM, {
      units: "kilometers",
    });
    if (
      grown &&
      booleanPointInPolygon(
        pt,
        grown as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
      )
    ) {
      return alpha3ToAlpha2(feature.properties.A3);
    }
  }

  const nearest = nearestCity(point, cities);
  if (nearest && nearest.dist <= NEAR_LAND_FALLBACK_KM) {
    return nearest.city.country;
  }
  return undefined;
}

function nearestCity(
  point: LatLng,
  pool: CityRecord[],
): { city: CityRecord; dist: number } | undefined {
  let best: CityRecord | undefined;
  let bestDist = Infinity;
  for (const city of pool) {
    const [lng, lat] = city.loc.coordinates;
    const d = haversineKm(point, { lat, lng });
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  }
  return best ? { city: best, dist: bestDist } : undefined;
}

/**
 * Nearest named place to a coordinate. Prefers cities within the given
 * country (when known) so e.g. a point near a border doesn't jump across
 * it; falls back to the globally nearest city otherwise.
 */
export function nearestPlaceName(point: LatLng, countryCode?: string): string {
  const pool = countryCode
    ? cities.filter((c) => c.country === countryCode)
    : cities;
  const searchPool = pool.length > 0 ? pool : cities;

  return nearestCity(point, searchPool)?.city.name ?? "Unknown location";
}

// A city's reach: a point's "city" is the most populous place within this
// distance, so a neighborhood (Westwood, Mission District) reads as the city
// it belongs to (Los Angeles, San Francisco).
const CITY_RADIUS_KM = 25;

/**
 * The city a coordinate belongs to: the most populous place within
 * CITY_RADIUS_KM (in the same country, when known), or the nearest named
 * place when nothing is that close. Used to decide which steps get a route
 * line between them (see src/lib/route.ts).
 */
export function cityNameFor(point: LatLng, countryCode?: string): string {
  // Cheap bounding-box prefilter before any distance math.
  const dLat = CITY_RADIUS_KM / 111;
  const dLng = dLat / Math.max(Math.cos((point.lat * Math.PI) / 180), 0.01);
  let best: CityRecord | undefined;
  for (const city of cities) {
    const [lng, lat] = city.loc.coordinates;
    if (Math.abs(lat - point.lat) > dLat || Math.abs(lng - point.lng) > dLng) {
      continue;
    }
    if (countryCode && city.country !== countryCode) continue;
    if (best && city.population <= best.population) continue;
    if (haversineKm(point, { lat, lng }) <= CITY_RADIUS_KM) best = city;
  }
  return best?.name ?? nearestPlaceName(point, countryCode);
}
