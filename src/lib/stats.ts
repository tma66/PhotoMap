// Aggregate trip/profile statistics shown in stat pills and the Travel
// stats tab. Pure functions over already-loaded rows — no DB access here,
// so these are easy to unit test.

interface StepLike {
  lat: number;
  lng: number;
  countryCode: string;
}

import { pathLengthKm } from "./geo";
import { countryByAlpha2 } from "./countries";

export function tripDistanceKm(steps: StepLike[]): number {
  return Math.round(pathLengthKm(steps));
}

export function tripDurationDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * "Day N" for a timestamp relative to a trip's start — counts real UTC
 * calendar-date boundaries since `start`'s date, matching the "YYYY-MM-DD"
 * keys photo overrides are filed under (`toISOString().slice(0, 10)`).
 * Shared by the trip page, the step-grouping algorithm (`steps.ts`), and the
 * ingest CLI's photo-override template so all three agree on which day a
 * photo falls under.
 */
export function dayNumber(date: Date, start: Date): number {
  const dayMs = 86_400_000;
  const startDay = Math.floor(start.getTime() / dayMs);
  const dateDay = Math.floor(date.getTime() / dayMs);
  return dateDay - startDay + 1;
}

/** Distinct cities across steps — by cityName, so several steps in one city
 * (neighborhoods of it, or a multi-day stay) count once. */
export function uniqueCityCount(steps: { cityName: string }[]): number {
  return new Set(steps.map((s) => s.cityName).filter(Boolean)).size;
}

export function uniqueCountryCodes(steps: StepLike[]): string[] {
  return [...new Set(steps.map((s) => s.countryCode).filter(Boolean))];
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
