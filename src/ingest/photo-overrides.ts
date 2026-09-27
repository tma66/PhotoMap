// Manual per-photo metadata, filled in by hand in trip.json under "photos"
// when EXIF has no GPS/caption or the auto-fetched weather is wrong. Grouped
// by the photo's own local date ("YYYY-MM-DD") purely for human readability
// — lookups below match by filename regardless of which date key it's filed
// under, and that key is recomputed (and the entry re-filed) on every
// regeneration, since a coord filled in by hand can correct which local day
// a photo actually falls on (see src/ingest/timezone.ts).
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

/** Flattens the by-day grouping into a filename-keyed index once, so a
 * caller looking up many photos against the same overrides (every media
 * item in a trip) doesn't re-scan every entry on every lookup. */
export function buildOverrideIndex(
  overrides: PhotoOverridesByDay | undefined,
): Map<string, PhotoOverride> {
  const index = new Map<string, PhotoOverride>();
  if (!overrides) return index;
  for (const entries of Object.values(overrides)) {
    for (const entry of entries) index.set(entry.file, entry);
  }
  return index;
}

export function findOverride(
  index: Map<string, PhotoOverride>,
  filename: string,
): PhotoOverride | undefined {
  return index.get(filename);
}

/**
 * Builds/updates the "photos" block of trip.json: one entry per photo,
 * (re)grouped by the photo's own local date. Only adds entries for photos
 * that don't have one yet, or drops ones for photos no longer on disk — an
 * existing entry's fields are never modified (beyond the one-time
 * locationName fill-in below; weather is filled in separately, by the
 * caller — see `index.ts`), matched purely by filename regardless of which
 * date key it was previously filed under. The date key itself, however, is
 * always recomputed from `m.takenAt` and the entry re-filed if it moved —
 * this is what lets filling in a `coord` (which can correct a photo's local
 * date via timezone lookup, see `index.ts`/`timezone.ts`) also fix which day
 * it's grouped under on the next run. A brand-new entry's `coord` is
 * pre-filled from real EXIF GPS when the photo has it — nothing left to
 * type in by hand for that one.
 */
export function buildPhotoTemplate(
  media: TaggedMedia[],
  existing: PhotoOverridesByDay | undefined,
): PhotoOverridesByDay {
  if (media.length === 0) return existing ?? {};

  const existingIndex = buildOverrideIndex(existing);
  const result: PhotoOverridesByDay = {};
  for (const m of media) {
    const filename = basename(m.sourcePath);
    const prior = findOverride(existingIndex, filename);
    const key = m.takenAt.toISOString().slice(0, 10);
    const entry: PhotoOverride = prior
      ? { ...prior }
      : {
          file: filename,
          coord: m.lat != null && m.lng != null ? `${m.lat},${m.lng}` : null,
          locationName: null,
          weatherTempF: null,
          weatherCode: null,
        };

    if (!entry.locationName) {
      const coord = parseCoord(entry.coord);
      if (coord) {
        const countryCode = countryCodeForPoint(coord);
        entry.locationName = nearestPlaceName(coord, countryCode);
      }
    }
    (result[key] ??= []).push(entry);
  }
  return result;
}
