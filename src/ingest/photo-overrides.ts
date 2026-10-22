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
  cover?: boolean; // the trip's card image — see writeTrip in index.ts
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
    const names = last === undefined ? namesFor(coord) : undefined;
    const changed = names
      ? entry.locationName !== names.locationName
      : last !== entry.coord;
    if (!changed) continue;
    Object.assign(entry, names ?? namesFor(coord));
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
 * time go after the rest, by name. Mutates `byDay`.
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
    entries.sort((a, b) => {
      const [ta, tb] = [timeOfDay(a.file), timeOfDay(b.file)];
      return ta === tb
        ? ta === Infinity
          ? a.file.localeCompare(b.file)
          : 0
        : ta - tb;
    });
  }
}

/**
 * Builds/updates one trip's "photos" block of trip.json. Existing entries
 * (matched by filename, wherever they were filed — in this trip's `own`
 * block first, when a filename is in several trips) stay exactly where they
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
  own?: PhotoOverridesByDay,
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

  for (const byDay of [own ?? {}, ...dayGroups(existing)]) {
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

const MAX_NEAREST_HOURS = 6;

/**
 * The "lat,lng" of the item nearest `target` in time, within
 * MAX_NEAREST_HOURS, among those with a coord and not named in `skip`;
 * copy-date (mtime) items have no real time, so they're skipped too.
 * Undefined if there's none — a photo days away may be in another city.
 * With `sameDay`, any gap is fine but only items on target's date count.
 */
export function nearestCoord(
  media: TaggedMedia[],
  target: TaggedMedia,
  skip: Map<string, string>,
  sameDay = false,
): string | undefined {
  const day = (m: TaggedMedia) => m.takenAt.toISOString().slice(0, 10);
  let best: TaggedMedia | undefined;
  let bestGap = sameDay ? Infinity : MAX_NEAREST_HOURS * 3_600_000;
  for (const m of media) {
    if (m === target || m.takenAtIsMtime || m.lat == null || m.lng == null) {
      continue;
    }
    if (skip.has(basename(m.sourcePath))) continue;
    if (sameDay && day(m) !== day(target)) continue;
    const gap = Math.abs(m.takenAt.getTime() - target.takenAt.getTime());
    if (best ? gap < bestGap : gap <= bestGap) {
      best = m;
      bestGap = gap;
    }
  }
  return best && `${best.lat},${best.lng}`;
}

const MAX_IMG_GAP = 500;

/** A camera file's IMG_#### counter, ignoring any date prefix
 * ("20240620-163600_IMG_7050.jpeg" → 7050). */
function imgNumber(file: string): number | undefined {
  const match = /IMG_(\d{4})(?!\d)/i.exec(file);
  return match ? Number(match[1]) : undefined;
}

/** `a - b` between IMG_#### counters, wrapping 9999 → 0001 (no 0000, so
 * the counter cycles every 9,999). */
const imgGap = (a: number, b: number) =>
  ((((a - b) % 9_999) + 14_998) % 9_999) - 4_999;

interface TimedImg {
  item: TaggedMedia;
  n: number;
  day: string;
}

/** Items with a real time and an IMG_#### counter. */
function timedImgs(media: TaggedMedia[]): TimedImg[] {
  return media.flatMap((m) => {
    const n = m.takenAtIsMtime ? undefined : imgNumber(basename(m.sourcePath));
    return n == null
      ? []
      : [{ item: m, n, day: m.takenAt.toISOString().slice(0, 10) }];
  });
}

/** The nearest of `timed` below and above counter `n`, within MAX_IMG_GAP,
 * and the nearer of the two (below on a tie). `gap` is `n - t.n`. */
function imgNeighbours(n: number, timed: TimedImg[]) {
  type Hit = TimedImg & { gap: number };
  let below: Hit | undefined;
  let above: Hit | undefined;
  for (const t of timed) {
    const gap = imgGap(n, t.n);
    if (gap >= 0 && gap <= MAX_IMG_GAP && (!below || gap < below.gap)) {
      below = { ...t, gap };
    } else if (gap < 0 && -gap <= MAX_IMG_GAP && (!above || gap > above.gap)) {
      above = { ...t, gap };
    }
  }
  const nearest = above && (!below || -above.gap < below.gap) ? above : below;
  return { below, above, nearest };
}

/** The cameras of the timed files within MAX_IMG_GAP of counter `n`. More
 * than one means two phones' counters overlap there, so `n` can't say which
 * phone an undated file came from. */
function camerasNear(n: number, timed: TimedImg[]): string[] {
  const cameras = new Set<string>();
  for (const t of timed) {
    if (t.item.camera && Math.abs(imgGap(n, t.n)) <= MAX_IMG_GAP) {
      cameras.add(t.item.camera);
    }
  }
  return [...cameras];
}

const MAX_AUTO_FILE_GAP = 5;

/**
 * Dates for copy-date (mtime) files still on their copy date (`candidates`),
 * from the timed files in `media` with an IMG_#### within MAX_IMG_GAP: the
 * nearest one's date when it's ≤ MAX_AUTO_FILE_GAP away, else the date shared
 * by the nearest below and above it. `unsure` maps the rest that have a
 * timed neighbour to those neighbours, for a hand move — and, with the
 * cameras, any whose number range more than one camera uses.
 */
export interface UnsureFile {
  near: { day: string; n: number }[];
  cameras?: string[];
}

export function undatedDays(
  media: TaggedMedia[],
  candidates: Set<TaggedMedia>,
): {
  moves: Map<string, string>;
  unsure: Map<string, UnsureFile>;
} {
  const timed = timedImgs(media);
  const moves = new Map<string, string>();
  const unsure = new Map<string, UnsureFile>();
  for (const m of candidates) {
    const file = basename(m.sourcePath);
    const n = imgNumber(file);
    if (n == null) continue;
    const { below, above, nearest } = imgNeighbours(n, timed);
    if (!nearest) continue;
    const cameras = camerasNear(n, timed);
    const day =
      cameras.length > 1
        ? undefined // the neighbours may be another phone's
        : Math.abs(nearest.gap) <= MAX_AUTO_FILE_GAP
          ? nearest.day
          : below && above && below.day === above.day
            ? below.day
            : undefined;
    if (day) {
      moves.set(file, day);
      continue;
    }
    unsure.set(file, {
      near: [below, above]
        .filter((t) => t != null)
        .map(({ day, n }) => ({ day, n })),
      ...(cameras.length > 1 && { cameras }),
    });
  }
  return { moves, unsure };
}

/**
 * Copy-date (mtime) items have no real time. Each one on a date with a timed
 * item from the same camera — the nearest IMG_#### within MAX_IMG_GAP,
 * wrapping 9999 → 0001 — takes that item's time, offset by the number gap in
 * ms so it sorts before or after it; then it's placed, ordered and given a
 * nearest coord like a timed item. Others, and any whose number range more
 * than one camera uses (see camerasNear), keep their mtime. Mutates `media`.
 */
export function estimateUndatedTimes(media: TaggedMedia[]): void {
  const timed = timedImgs(media);
  for (const m of media) {
    const n = m.takenAtIsMtime ? imgNumber(basename(m.sourcePath)) : undefined;
    if (n == null || camerasNear(n, timed).length > 1) continue;
    const day = m.takenAt.toISOString().slice(0, 10);
    const { nearest } = imgNeighbours(
      n,
      timed.filter((t) => t.day === day),
    );
    if (!nearest) continue;
    m.takenAt = new Date(nearest.item.takenAt.getTime() + nearest.gap);
    m.takenAtIsEstimated = true;
  }
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
