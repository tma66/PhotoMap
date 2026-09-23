// Fully offline reverse geocoding: which country is this point in, and
// what's the nearest named place — no network calls, no API key.
//
// Country: point-in-polygon against @geo-maps/countries-land-10km (OSM-derived
// 10km-resolution borders, features carry an ISO 3166-1 alpha-3 "A3" code).
// Place name: nearest entry in `all-the-cities` (GeoNames-derived, ~138k
// places with population >= 1000).
import { booleanPointInPolygon } from "@turf/turf";
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
  return undefined;
}

/**
 * Nearest named place to a coordinate. Prefers cities within the given
 * country (when known) so e.g. a point near a border doesn't jump across
 * it; falls back to the globally nearest city otherwise.
 */
export function nearestPlaceName(point: LatLng, countryCode?: string): string {
  let best: CityRecord | undefined;
  let bestDist = Infinity;

  const pool = countryCode
    ? cities.filter((c) => c.country === countryCode)
    : cities;
  const searchPool = pool.length > 0 ? pool : cities;

  for (const city of searchPool) {
    const [lng, lat] = city.loc.coordinates;
    const d = haversineKm(point, { lat, lng });
    if (d < bestDist) {
      bestDist = d;
      best = city;
    }
  }

  return best?.name ?? "Unknown location";
}
