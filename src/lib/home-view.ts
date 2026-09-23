export interface HomeTripCard {
  slug: string;
  title: string;
  coverUrl: string | null;
  subtitleLabel: string; // "2024 NOVEMBER · 681 DAYS · 69,951 KM · 708 STEPS"
}

export interface HomeGlobeStep {
  id: string;
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
    countryCount: number;
  };
  tripCards: HomeTripCard[];
  globeSteps: HomeGlobeStep[];
  stats: {
    countries: number;
    countryFlags: string[];
    percentOfWorld: number;
    continents: string[];
    totalKmLabel: string;
    totalSteps: number;
    totalTrips: number;
  };
}
