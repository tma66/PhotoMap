export interface HomeTripCard {
  slug: string;
  title: string;
  coverUrl: string | null;
  subtitleLabel: string; // "NOVEMBER 2024 · 681 DAYS · 69,951 km"
}

export interface HomeGlobeStep {
  lat: number;
  lng: number;
  thumbUrl: string | null;
  tripId: string; // trip slug, used to navigate on tap
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
