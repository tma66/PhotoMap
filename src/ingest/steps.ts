// Groups a trip's timestamped, geotagged photos/videos into Polarsteps-style
// "steps" — a new step whenever the photos jump far enough, or enough time
// has passed at a materially different spot.
import { haversineKm, type LatLng } from "../lib/geo";

export const NEW_STEP_DISTANCE_KM = 25; // always a new step past this, regardless of timing
export const NEW_STEP_SAME_PLACE_KM = 2; // below this, never split just for a day gap
export const NEW_STEP_MIN_HOURS = 20; // "new day" threshold, only applies between SAME_PLACE and DISTANCE_KM
export const FLIGHT_MIN_KM = 300;
export const FLIGHT_MIN_KMH = 150;

export interface TaggedMedia {
  /** Absolute path on disk, used only during ingestion — never sent to the client. */
  sourcePath: string;
  type: "IMAGE" | "VIDEO";
  takenAt: Date;
  lat?: number;
  lng?: number;
  caption?: string;
  width: number;
  height: number;
  durationSec?: number;
}

export interface DraftStep {
  centroid: LatLng;
  arrivedAt: Date;
  media: TaggedMedia[];
  captions: string[];
}

/**
 * `media` must be sorted by `takenAt` ascending. Items without GPS are
 * attached to whichever step is nearest in time.
 */
export function groupIntoSteps(media: TaggedMedia[]): DraftStep[] {
  const located = media.filter(
    (m): m is TaggedMedia & { lat: number; lng: number } =>
      m.lat != null && m.lng != null,
  );
  const unlocated = media.filter((m) => m.lat == null || m.lng == null);

  const steps: DraftStep[] = [];

  for (const m of located) {
    const last = steps.at(-1);
    const point: LatLng = { lat: m.lat, lng: m.lng };
    const distFromLast = last ? haversineKm(last.centroid, point) : Infinity;

    const shouldStartNew =
      !last ||
      distFromLast > NEW_STEP_DISTANCE_KM ||
      (distFromLast > NEW_STEP_SAME_PLACE_KM &&
        hoursBetween(last.arrivedAt, m.takenAt) > NEW_STEP_MIN_HOURS);

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
      // Recompute centroid as a running average so a long stay drifts
      // toward its true center rather than staying pinned to the first shot.
      const n = last.media.length;
      last.centroid = {
        lat: last.centroid.lat + (point.lat - last.centroid.lat) / n,
        lng: last.centroid.lng + (point.lng - last.centroid.lng) / n,
      };
    }
  }

  // Attach GPS-less media (e.g. a screenshot, or a photo EXIF stripped by
  // messaging apps) to the nearest-in-time step.
  for (const m of unlocated) {
    const step = nearestStepInTime(steps, m.takenAt);
    if (step) {
      step.media.push(m);
      if (m.caption) step.captions.push(m.caption);
    }
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

export type TransportMode =
  | "FLIGHT"
  | "TRAIN"
  | "CAR"
  | "BUS"
  | "BOAT"
  | "FOOT"
  | "BIKE"
  | "VAN";

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
