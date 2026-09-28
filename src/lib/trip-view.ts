// Shapes passed from the trip page's Server Component down to client
// components. Everything the client would otherwise have to recompute
// (labels, flags, "traveled for" gaps) is precomputed here instead, so
// client components stay dumb renderers with no date-math duplication.
interface MediaView {
  hash: string;
  type: "IMAGE" | "VIDEO";
  thumbUrl: string;
  displayUrl: string;
  /** Inline only for a step's cover (its carousel card); the rest arrive
   * after the page does — see TripView.tsx. */
  placeholder: string | null;
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
  backHref: string; // "/" or, in a multi-trip folder, its selector page
  path: string; // this page's own URL, "/m/EDC/2"
  zoomName: string; // matches the tile that opens it — see page-transition.ts
  owner: { name: string; avatarUrl: string | null };
  flags: string[];
  statsLabel: string; // "28 days · 6 cities · 4,099 km"
  startDateLabel: string; // "SUN, AUG 16, 2026" — trip-started bookend card
  endDateLabel: string; // "SUN, AUG 23, 2026" — trip-finished bookend card
  steps: StepView[];
  trackPoints: { tISO: string; lat: number; lng: number }[];
}

/** The /m/<slug> page for a folder holding several trips — one tile each. */
export interface TripSelectorData {
  title: string; // folder's trip title, e.g. "EDC"
  path: string; // this page's own URL, "/m/EDC"
  owner: { name: string; avatarUrl: string | null };
  tiles: {
    href: string; // "/m/EDC/2"
    zoomName: string; // matches the trip page it opens — see page-transition.ts
    coverUrl: string | null;
    title: string; // "May 2026"
    subtitleLabel: string; // "8 DAYS · 17 km"
  }[];
}
