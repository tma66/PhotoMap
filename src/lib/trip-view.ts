// Shapes passed from the trip page's Server Component down to client
// components. Everything the client would otherwise have to recompute
// (labels, flags, "traveled for" gaps) is precomputed here instead, so
// client components stay dumb renderers with no date-math duplication.
export interface MediaView {
  hash: string;
  type: "IMAGE" | "VIDEO";
  thumbUrl: string;
  displayUrl: string;
  placeholder: string;
  durationSec: number | null;
}

export interface StepView {
  id: string;
  order: number;
  dayNumber: number;
  title: string;
  locationName: string;
  countryCode: string;
  flag: string;
  dateLabel: string;
  weatherIcon: string;
  weatherTempC: number | null;
  lat: number;
  lng: number;
  arrivedAtISO: string;
  transportMode: string;
  journalText: string;
  travelGapLabel: string | null;
  isLatest: boolean;
  media: MediaView[];
}

export interface TripView {
  slug: string;
  title: string;
  description: string;
  ownerName: string;
  ownerAvatarUrl: string | null;
  flags: string[];
  statsLabel: string; // "28 days · 37 steps · 4,099 km"
  steps: StepView[];
  trackPoints: { tISO: string; lat: number; lng: number }[];
}
