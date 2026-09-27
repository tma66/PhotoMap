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
