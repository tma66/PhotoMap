// Manual per-photo metadata, filled in by hand in trip.json under "photos"
// when EXIF has no GPS/caption or the auto-fetched weather is wrong. Grouped
// by date ("YYYY-MM-DD"). A new entry is filed under the photo's own local
// date; after that, the date it's filed under is the photo's date — moving
// an entry to another date by hand overrides a wrong one (e.g. a photo with
// no EXIF date, which falls back to the file's own date), unless the file
// records a date within 7 days of it (see misfiledMoves). See filedDates.
import { basename } from "node:path";
import { cityNameFor, countryCodeForPoint, nearestPlaceName } from "./geocode";
import type { LatLng } from "../lib/geo";
import { HEAVEN_PLACE, isHeaven } from "../lib/heaven";
import type { TaggedMedia } from "./steps";

interface PhotoOverride {
  file: string; // basename, e.g. "IMG_1234.HEIC"
  coord?: string | null; // "lat,lng", e.g. "1.8173,73.4049"
  locationName?: string | null;
  cityName?: string | null; // decides route lines — see src/lib/route.ts
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

/** True when two coords are the same spot (within ~10 cm). */
export function isSameCoord(a: LatLng | undefined, b: LatLng): boolean {
  return (
    a != null &&
    Math.abs(a.lat - b.lat) < 1e-6 &&
    Math.abs(a.lng - b.lng) < 1e-6
  );
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

/** The place and city names a coord resolves to (offline — see geocode.ts). */
export function namesFor(coord: LatLng): {
  locationName: string;
  cityName: string;
} {
  if (isHeaven(coord)) {
    return { locationName: HEAVEN_PLACE, cityName: HEAVEN_PLACE };
  }
  const countryCode = countryCodeForPoint(coord);
  return {
    locationName: nearestPlaceName(coord, countryCode),
    cityName: cityNameFor(coord, countryCode),
  };
}

/**
 * Re-derives locationName and cityName (and, with `clearWeather`, blanks
 * weather so the caller refetches it) for every entry whose coord changed since the last
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
    const last = lastCoords[entry.file];
    const changed =
      last !== undefined
        ? last !== entry.coord
        : entry.locationName !== namesFor(coord).locationName;
    if (!changed) continue;
    Object.assign(entry, namesFor(coord));
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
 * Moves each entry named in `moves` (file -> date) to the end of that date's
 * list, every field unchanged. A date left empty is removed; dates stay
 * sorted. Mutates `byDay`.
 */
export function moveEntries(
  byDay: PhotoOverridesByDay,
  moves: Map<string, string>,
): void {
  for (const [day, entries] of Object.entries(byDay)) {
    for (const entry of entries.filter((e) => moves.has(e.file))) {
      const to = moves.get(entry.file)!;
      if (to === day) continue;
      entries.splice(entries.indexOf(entry), 1);
      (byDay[to] ??= []).push(entry);
    }
  }
  const sorted = Object.entries(byDay)
    .filter(([, entries]) => entries.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const day of Object.keys(byDay)) delete byDay[day];
  Object.assign(byDay, Object.fromEntries(sorted));
}

export const DAY_MS = 86_400_000;

/**
 * Sorts each date's entries by time of day, the order the site shows them
 * in (a filed date keeps the photo's own time of day). Entries with no known
 * time keep their relative order, after the rest. Mutates `byDay`.
 */
export function sortEntriesByTime(
  byDay: PhotoOverridesByDay,
  takenAtByFile: Map<string, Date>,
): void {
  const timeOfDay = (file: string) => {
    const t = takenAtByFile.get(file)?.getTime();
    return t == null ? Infinity : ((t % DAY_MS) + DAY_MS) % DAY_MS;
  };
  for (const entries of Object.values(byDay)) {
    entries.sort((a, b) => timeOfDay(a.file) - timeOfDay(b.file));
  }
}

/**
 * Builds/updates one trip's "photos" block of trip.json. Existing entries
 * (matched by filename, wherever they were filed) stay exactly where they
 * are — same date, same order (index.ts then re-sorts each date by time,
 * see sortEntriesByTime) — with only a missing locationName/cityName filled in
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
  const add = (day: string, existing: PhotoOverride) => {
    // cityName sits next to locationName, also in entries written before it existed.
    const { file, coord: c, locationName, cityName = null, ...rest } = existing;
    const entry: PhotoOverride = {
      file,
      coord: c,
      locationName,
      cityName,
      ...rest,
    };
    const coord = parseCoord(entry.coord);
    if (coord && (!entry.locationName || !entry.cityName)) {
      const names = namesFor(coord);
      entry.locationName ||= names.locationName;
      entry.cityName ||= names.cityName;
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
      cityName: null,
      weatherTempF: null,
      weatherCode: null,
    });
  }
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * The "lat,lng" of the item nearest `target` in time, among those with a
 * coord and not named in `skip`; copy-date (mtime) items have no real time,
 * so they're skipped too. Undefined if there's none.
 */
export function nearestCoord(
  media: TaggedMedia[],
  target: TaggedMedia,
  skip: Map<string, string>,
): string | undefined {
  let best: TaggedMedia | undefined;
  for (const m of media) {
    if (m === target || m.takenAtIsMtime || m.lat == null || m.lng == null) {
      continue;
    }
    if (skip.has(basename(m.sourcePath))) continue;
    const gap = Math.abs(m.takenAt.getTime() - target.takenAt.getTime());
    if (
      !best ||
      gap < Math.abs(best.takenAt.getTime() - target.takenAt.getTime())
    ) {
      best = m;
    }
  }
  return best && `${best.lat},${best.lng}`;
}

const MAX_MOVE_DAYS = 7;

/**
 * The entries in `block` filed under a date other than their file's own,
 * mapped to that date: any date, for a file with a recorded local time
 * (EXIF, QuickTime creationdate/date); only its raw UTC date — where older
 * ingests filed it — for one whose only time is a UTC instant (e.g. a video
 * with just creation_time, which may be a re-save's time). `utcDays` are the
 * media's dates before localizeExactInstants. A copy-date (mtime) file has
 * no real date, so it stays wherever it's filed; so does one filed more
 * than MAX_MOVE_DAYS from its date (e.g. a screen recording, dated when
 * recorded, filed by hand under the day it shows).
 */
export function misfiledMoves(
  media: TaggedMedia[],
  utcDays: string[],
  block: PhotosBlock | undefined,
): Map<string, string> {
  const filed = filedDates(block);
  const moves = new Map<string, string>();
  media.forEach((m, i) => {
    const file = basename(m.sourcePath);
    const day = m.takenAt.toISOString().slice(0, 10);
    const at = filed.get(file);
    const misfiled = m.takenAtIsExact
      ? !m.takenAtIsMtime && at === utcDays[i]
      : at != null &&
        Math.abs(Date.parse(at) - Date.parse(day)) <= MAX_MOVE_DAYS * DAY_MS;
    if (misfiled && at !== day) moves.set(file, day);
  });
  return moves;
}
