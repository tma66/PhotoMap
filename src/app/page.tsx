import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import { continentsVisited, percentOfWorldSeen } from "@/lib/stats";
import {
  formatDistance,
  formatMonthYearCaps,
  countryCodeToFlagEmoji,
} from "@/lib/format";
import { tripDurationDays } from "@/lib/stats";
import HomeView from "@/components/HomeView";
import type { HomeTripCard, HomeData } from "@/lib/home-view";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [profile, trips] = await Promise.all([
    loadProfile(),
    prisma.trip.findMany({
      include: {
        steps: { include: { media: true }, orderBy: { order: "asc" } },
      },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const tripCards: HomeTripCard[] = trips.map((trip) => {
    const coverStep = trip.steps.find((s) => s.media.length > 0);
    const coverMedia = coverStep?.media[0];
    const days = tripDurationDays(trip.startDate, trip.endDate);
    return {
      slug: trip.slug,
      title: trip.title,
      coverUrl: coverMedia
        ? mediaUrl(trip.slug, coverMedia.hash, "display")
        : null,
      subtitleLabel: `${formatMonthYearCaps(trip.startDate)} · ${days} DAYS · ${formatDistance(trip.distanceKm)} · ${trip.steps.length} STEPS`,
    };
  });

  const globeSteps = trips.flatMap((trip) =>
    trip.steps
      .filter((s) => s.media.length > 0)
      .map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        thumbUrl: mediaUrl(trip.slug, s.media[0]!.hash, "thumb"),
        tripId: trip.slug,
        order: s.order,
      })),
  );

  const allCountryCodes = [
    ...new Set(trips.flatMap((t) => JSON.parse(t.countryCodes) as string[])),
  ];
  const continents = continentsVisited(allCountryCodes);
  const totalSteps = trips.reduce((n, t) => n + t.steps.length, 0);
  const totalKm = Math.round(trips.reduce((n, t) => n + t.distanceKm, 0));

  const data: HomeData = {
    profile: {
      name: profile.name,
      bio: profile.bio,
      avatarUrl: profile.avatar,
      countryCount: allCountryCodes.length,
    },
    tripCards,
    globeSteps,
    stats: {
      countries: allCountryCodes.length,
      countryFlags: allCountryCodes.map(countryCodeToFlagEmoji),
      percentOfWorld: percentOfWorldSeen(allCountryCodes),
      continents,
      totalKmLabel: formatDistance(totalKm),
      totalSteps,
      totalTrips: trips.length,
    },
  };

  return <HomeView data={data} />;
}
