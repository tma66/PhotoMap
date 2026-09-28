// Manual per-photo metadata, filled in by hand in trip.json under "photos"
// when EXIF has no GPS/caption or the auto-fetched weather is wrong. Grouped
// by date ("YYYY-MM-DD"). A new entry is filed under the photo's own local
// date; after that, the date it's filed under is the photo's date — moving
// an entry to another date by hand overrides a wrong one (e.g. a photo with
// no EXIF date, which falls back to the file's own date). See filedDates.
import { basename } from "node:path";
import { countryCodeForPoint, nearestPlaceName } from "./geocode";
import type { LatLng } from "../lib/geo";
import type { TaggedMedia } from "./steps";

interface PhotoOverride {
  file: string; // basename, e.g. "IMG_1234.HEIC"
  coord?: string | null; // "lat,lng", e.g. "1.8173,73.4049"
  locationName?: string | null;
  weatherTempF?: number | null;
  weatherCode?: number | null;
}

/** Parses a PhotoOverride's "lat,lng" string; undefined if missing/malformed. */
export function parseCoord(
  coord: string | null | undefined,
): LatLng | undefined {
  if (!coord) return undefined;
  const [lat, lng] = coord.split(",").map((s) => Number(s.trim()));
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return undefined;
  }
  return { lat, lng };
}

/** Keyed by the photo's own date ("YYYY-MM-DD"), not a day-since-start number. */
export type PhotoOverridesByDay = Record<string, PhotoOverride[]>;

/** trip.json's whole "photos" block: flat by-day for a single-trip folder,
 * or nested by trip number ("1", "3", ...) first when the folder holds
 * trip subfolders (see listTrips in index.ts). */
export type PhotosBlock =
  | PhotoOverridesByDay
  | Record<string, PhotoOverridesByDay>;

/** The by-day maps inside a photos block — one for a flat block, one per
 * trip for a nested one. */
export function dayGroups(
  block: PhotosBlock | undefined,
): PhotoOverridesByDay[] {
  if (!block) return [];
  const values = Object.values(block);
  return values.every((v) => Array.isArray(v))
    ? [block as PhotoOverridesByDay]
    : (values as PhotoOverridesByDay[]);
}

/** Every entry in a photos block (same object references, so callers can
 * fill fields in place), whichever layout it uses. */
export function allEntries(block: PhotosBlock | undefined): PhotoOverride[] {
  return dayGroups(block).flatMap((byDay) => Object.values(byDay).flat());
}

/** Flattens the photos block into a filename-keyed index once, so a caller
 * looking up many photos against the same overrides (every media item in a
 * trip) doesn't re-scan every entry on every lookup. */
export function buildOverrideIndex(
  overrides: PhotosBlock | undefined,
): Map<string, PhotoOverride> {
  const index = new Map<string, PhotoOverride>();
  for (const entry of allEntries(overrides)) index.set(entry.file, entry);
  return index;
}

/** The place name a coord resolves to (offline — see geocode.ts). */
function placeNameFor(coord: LatLng): string {
  return nearestPlaceName(coord, countryCodeForPoint(coord));
}

/**
 * Re-derives locationName (and, with `clearWeather`, blanks weather so the
 * caller refetches it) for every entry whose coord changed since the last
 * template run — `lastCoords` maps file -> coord as of then. An entry with
 * no record yet counts as changed only if its locationName doesn't match its
 * coord, so a name or weather typed in by hand survives while the coord it
 * belongs to stays the same. Returns the files that were refreshed.
 */
export function refreshChangedCoords(
  block: PhotosBlock,
  lastCoords: Record<string, string>,
  clearWeather: boolean,
): string[] {
  const refreshed: string[] = [];
  for (const entry of allEntries(block)) {
    const coord = parseCoord(entry.coord);
    if (!coord) continue;
    const name = placeNameFor(coord);
    const last = lastCoords[entry.file];
    const changed =
      last !== undefined ? last !== entry.coord : entry.locationName !== name;
    if (!changed) continue;
    entry.locationName = name;
    if (clearWeather) {
      entry.weatherTempF = null;
      entry.weatherCode = null;
    }
    refreshed.push(entry.file);
  }
  return refreshed;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The date each photo is filed under in a photos block, by filename. */
export function filedDates(
  block: PhotosBlock | undefined,
): Map<string, string> {
  const dates = new Map<string, string>();
  for (const byDay of dayGroups(block)) {
    for (const [day, entries] of Object.entries(byDay)) {
      if (!DATE_KEY.test(day)) continue;
      for (const entry of entries) dates.set(entry.file, day);
    }
  }
  return dates;
}

/**
 * Builds/updates one trip's "photos" block of trip.json. Existing entries
 * (matched by filename, wherever they were filed) stay exactly where they
 * are — same date, same order — with only a missing locationName filled in
 * below (refreshing names/weather after a coord change, and fetching
 * weather, is the caller's job — see refreshChangedCoords and `index.ts`).
 * Entries for photos no longer on disk are dropped, and each new photo gets
 * an entry at the end of its own local date, its `coord` pre-filled from
 * real EXIF GPS when it has it.
 */
export function buildPhotoTemplate(
  media: TaggedMedia[],
  existing: PhotosBlock | undefined,
): PhotoOverridesByDay {
  const onDisk = new Map(media.map((m) => [basename(m.sourcePath), m]));
  const result: PhotoOverridesByDay = {};
  const add = (day: string, entry: PhotoOverride) => {
    if (!entry.locationName) {
      const coord = parseCoord(entry.coord);
      if (coord) entry.locationName = placeNameFor(coord);
    }
    (result[day] ??= []).push(entry);
    onDisk.delete(entry.file);
  };

  for (const byDay of dayGroups(existing)) {
    for (const [day, entries] of Object.entries(byDay)) {
      for (const entry of entries) {
        if (onDisk.has(entry.file)) add(day, { ...entry });
      }
    }
  }
  for (const [file, m] of onDisk) {
    add(m.takenAt.toISOString().slice(0, 10), {
      file,
      coord: m.lat != null && m.lng != null ? `${m.lat},${m.lng}` : null,
      locationName: null,
      weatherTempF: null,
      weatherCode: null,
    });
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
