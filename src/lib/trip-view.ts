// Shapes passed from the trip page's Server Component down to client
// components. Everything the client would otherwise have to recompute
// (labels, flags, "traveled for" gaps) is precomputed here instead, so
// client components stay dumb renderers with no date-math duplication.
interface MediaView {
  hash: string;
  type: "IMAGE" | "VIDEO";
  thumbUrl: string;
  displayUrl: string;
  placeholder: string;
  /** Set only for type "VIDEO" — the playable derivative (thumb/display are
   * its poster frame, same as any other photo). */
  videoUrl: string | null;
  durationSec: number | null;
}

export interface StepView {
  id: string;
  dayNumber: number;
  title: string;
  locationName: string;
  countryCode: string;
  countryName: string;
  flag: string;
  dateLabel: string;
  weatherIcon: string;
  weatherTempF: number | null;
  lat: number;
  lng: number;
  arrivedAtISO: string;
  transportMode: string;
  journalText: string;
  media: MediaView[];
}

export interface TripView {
  title: string;
  owner: { name: string; avatarUrl: string | null };
  flags: string[];
  statsLabel: string; // "28 days · 6 cities · 4,099 km"
  startDateLabel: string; // "SUN, AUG 16, 2026" — trip-started bookend card
  endDateLabel: string; // "SUN, AUG 23, 2026" — trip-finished bookend card
  steps: StepView[];
  trackPoints: { tISO: string; lat: number; lng: number }[];
}
