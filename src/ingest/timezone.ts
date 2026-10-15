// Converts a real absolute instant (e.g. a file's mtime, used when a photo
// has no EXIF date at all) into the local calendar date/time at a given
// coordinate — offline, via geo-tz's timezone-boundary polygons, no network.
import { find as findTimeZones } from "geo-tz";
import type { LatLng } from "../lib/geo";

const localDateFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = localDateFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    localDateFormatter.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Re-expresses a real instant as the local wall-clock time at `coord`,
 * encoded the same way the rest of ingestion encodes EXIF timestamps (naive
 * local time, as if it were UTC) — so `.toISOString().slice(0, 10)` and
 * `dayNumber()` treat it identically to an ordinary EXIF-dated photo.
 */
export function localizeInstant(instant: Date, coord: LatLng): Date {
  const [timeZone] = findTimeZones(coord.lat, coord.lng);
  if (!timeZone) return instant;

  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  return new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    ),
  );
}

/**
 * For media whose `takenAt` is a real instant but which has no coordinate to
 * localize at (e.g. a video with only QuickTime's UTC creation_time): borrow
 * the UTC offset of the item nearest in time that recorded one, and
 * re-express the instant as local time in the same encoding. Items with no
 * such neighbour are left as UTC. Mutates `media`.
 */
export function localizeByNearestOffset(
  media: {
    takenAt: Date;
    takenAtIsExact?: boolean;
    utcOffsetMin?: number;
    lat?: number;
  }[],
): void {
  const MIN = 60_000;
  // Real instants of the items with a recorded offset (their takenAt is
  // naive local time, so subtract the offset).
  const anchors = media
    .filter((m) => !m.takenAtIsExact && m.utcOffsetMin != null)
    .map((m) => ({
      instant: m.takenAt.getTime() - m.utcOffsetMin! * MIN,
      offset: m.utcOffsetMin!,
    }));
  if (anchors.length === 0) return;

  for (const m of media) {
    if (!m.takenAtIsExact || m.lat != null) continue;
    const t = m.takenAt.getTime();
    let nearest = anchors[0]!;
    for (const a of anchors) {
      if (Math.abs(a.instant - t) < Math.abs(nearest.instant - t)) nearest = a;
    }
    m.takenAt = new Date(t + nearest.offset * MIN);
  }
}
