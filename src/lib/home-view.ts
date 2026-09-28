export interface HomeTripCard {
  slug: string; // assets/ folder name
  href: string; // "/m/<slug>/<n>", or "/m/<slug>" for a multi-trip folder
  zoomName: string | null; // single trip: zooms into it (page-transition.ts); null pushes the selector
  title: string;
  coverUrl: string | null;
  subtitleLabel: string | null; // "NOVEMBER 2024 · 681 DAYS · 69,951 km"; null for a multi-trip folder
}

export interface HomeGlobeStep {
  lat: number;
  lng: number;
  thumbUrl: string | null;
  tripId: string; // "<slug>/<n>" — unique per trip, used to navigate on tap
  order: number;
}

export interface HomeData {
  profile: {
    name: string;
    bio: string;
    avatarUrl: string | null;
  };
  tripCards: HomeTripCard[];
  globeSteps: HomeGlobeStep[];
  stats: {
    countries: number;
    countryFlags: string[];
    percentOfWorld: number;
    totalKmLabel: string;
    totalCities: number;
    totalDays: number;
    totalTrips: number;
  };
}
