// Aggregate trip/profile statistics shown in stat pills and the Travel
// stats tab. Pure functions over already-loaded rows — no DB access here,
// so these are easy to unit test.

export interface StepLike {
  lat: number;
  lng: number;
  countryCode: string;
}

import { haversineKm, type LatLng } from "./geo";
import { countryByAlpha2 } from "./countries";

export function tripDistanceKm(steps: StepLike[]): number {
  let total = 0;
  for (let i = 1; i < steps.length; i++) {
    total += haversineKm(steps[i - 1]!, steps[i]!);
  }
  return Math.round(total);
}

export function tripDurationDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function uniqueCountryCodes(steps: StepLike[]): string[] {
  return [...new Set(steps.map((s) => s.countryCode).filter(Boolean))];
}

/** Continents (world-countries' `region` field) covered by these ISO codes. */
export function continentsVisited(countryCodes: string[]): string[] {
  return [
    ...new Set(
      countryCodes
        .map((cc) => countryByAlpha2(cc)?.region)
        .filter((r): r is string => Boolean(r)),
    ),
  ];
}

const EARTH_LAND_AREA_KM2 = 148_940_000; // total land area, for a rough "% of the world" figure

/**
 * Rough "% of the world seen" — sum of visited countries' land area (from
 * world-countries) as a share of Earth's total land area. Not a claim of
 * precision, matches the spirit of the app's own "% of the world" stat.
 */
export function percentOfWorldSeen(countryCodes: string[]): number {
  const visitedAreaKm2 = countryCodes.reduce(
    (sum, cc) => sum + (countryByAlpha2(cc)?.areaKm2 ?? 0),
    0,
  );
  return Math.round((visitedAreaKm2 / EARTH_LAND_AREA_KM2) * 1000) / 10;
}

export function centroid(points: LatLng[]): LatLng {
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}
