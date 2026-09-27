// Groups a trip's timestamped, geotagged photos/videos into "steps" — one
// step per calendar day (so a multi-day stay at one resort is still a
// "Day 1"/"Day 2"/"Day 3" progression), plus an extra split whenever the
// photos jump far enough within the same day (e.g. a same-day flight).
import { haversineKm, type LatLng } from "../lib/geo";
import { dayNumber } from "../lib/stats";

const NEW_STEP_DISTANCE_KM = 25; // always a new step past this, regardless of timing
const FLIGHT_MIN_KM = 300;
// Implied speed is measured photo-to-photo (last shot before departing to
// first shot after arriving), which always includes some real but
// unphotographed time — checkout, the airport, immigration, the ride to the
// hotel — that a cruising-speed threshold doesn't account for. 100km/h
// leaves comfortable margin below that on a long-haul flight (a 3,000km+
// trip still reads as "fast" even with a full day of slack on either end)
// while staying safely above a realistic full-day overland average (driving
// or a train, including stops) on a route where that's actually possible.
const FLIGHT_MIN_KMH = 100;

export interface TaggedMedia {
  /** Absolute path on disk, used only during ingestion — never sent to the client. */
  sourcePath: string;
  /** Decided once from the file extension when the trip is scanned — every
   * later stage (metadata reader, derivative processor, DB row type) reads
   * this instead of re-testing the extension itself. */
  kind: "photo" | "video";
  takenAt: Date;
  /** True when `takenAt` is a real absolute instant (file mtime, no EXIF
   * date available) rather than a naive local wall-clock value encoded as
   * if it were UTC (the normal EXIF case) — see src/ingest/timezone.ts. */
  takenAtIsExact?: boolean;
  lat?: number;
  lng?: number;
  caption?: string;
}

interface DraftStep {
  centroid: LatLng;
  arrivedAt: Date;
  media: TaggedMedia[];
  captions: string[];
}

/**
 * `media` must be sorted by `takenAt` ascending. Items without GPS attach to
 * whichever real (GPS-anchored) step is nearest in time, as long as it's the
 * same day — otherwise there's nowhere sensible to place them, so they're
 * dropped (e.g. a photo with no GPS on a day with no other geotagged photo).
 */
export function groupIntoSteps(media: TaggedMedia[]): DraftStep[] {
  const located = media.filter(
    (m): m is TaggedMedia & { lat: number; lng: number } =>
      m.lat != null && m.lng != null,
  );
  const unlocated = media.filter((m) => m.lat == null || m.lng == null);
  // Anchor for "day since trip start" — same reference point used
  // everywhere else a day number is computed (trip.startDate === this).
  const firstTakenAt = media[0]?.takenAt;
  const sameDay = (a: Date, b: Date) =>
    dayNumber(a, firstTakenAt!) === dayNumber(b, firstTakenAt!);

  const steps: DraftStep[] = [];

  for (const m of located) {
    const last = steps.at(-1);
    const point: LatLng = { lat: m.lat, lng: m.lng };
    const distFromLast = last ? haversineKm(last.centroid, point) : Infinity;

    const shouldStartNew =
      !last ||
      distFromLast > NEW_STEP_DISTANCE_KM ||
      !sameDay(last.arrivedAt, m.takenAt);

    if (shouldStartNew) {
      steps.push({
        centroid: point,
        arrivedAt: m.takenAt,
        media: [m],
        captions: m.caption ? [m.caption] : [],
      });
    } else {
      last.media.push(m);
      if (m.caption) last.captions.push(m.caption);
      // centroid intentionally stays at the step's first photo's coordinate
      // (its preview/cover image in the carousel) rather than drifting to an
      // average — the pin should always match what the cover photo shows.
    }
  }

  for (const m of unlocated) {
    const nearestReal = nearestStepInTime(steps, m.takenAt);
    const nearCloseEnough =
      nearestReal && sameDay(nearestReal.arrivedAt, m.takenAt);
    if (!nearCloseEnough) continue; // nowhere sensible to put it

    nearestReal.media.push(m);
    if (m.caption) nearestReal.captions.push(m.caption);
  }

  for (const step of steps) {
    step.media.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  }

  return steps;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 3_600_000;
}

function nearestStepInTime(steps: DraftStep[], t: Date): DraftStep | undefined {
  let best: DraftStep | undefined;
  let bestDiff = Infinity;
  for (const step of steps) {
    const diff = Math.abs(step.arrivedAt.getTime() - t.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = step;
    }
  }
  return best;
}

// Only FLIGHT, FOOT and CAR are ever inferred (see inferTransportMode) — the
// UI only distinguishes FLIGHT from everything else (src/lib/route.ts), so
// there's no ground-transport subtype to add here yet.
type TransportMode = "FLIGHT" | "FOOT" | "CAR";

/**
 * Guess how someone got from one step to the next, from distance and
 * implied average speed. Deliberately coarse — there's no ground truth
 * without a GPX track, so this only distinguishes flight vs. "some kind of
 * ground transport" (rendered generically, not per-vehicle) by default.
 */
export function inferTransportMode(
  fromKm: LatLng,
  toKm: LatLng,
  fromTime: Date,
  toTime: Date,
): TransportMode {
  const distanceKm = haversineKm(fromKm, toKm);
  const hours = Math.max(hoursBetween(fromTime, toTime), 1 / 60);
  const speedKmh = distanceKm / hours;

  if (distanceKm >= FLIGHT_MIN_KM && speedKmh >= FLIGHT_MIN_KMH) {
    return "FLIGHT";
  }
  if (distanceKm < 2) return "FOOT";
  return "CAR";
}
