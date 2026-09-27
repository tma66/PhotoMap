import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import {
  percentOfWorldSeen,
  uniqueCityCount,
  tripDurationDays,
} from "@/lib/stats";
import {
  formatDistance,
  formatMonthYearCaps,
  countryCodeToFlagEmoji,
} from "@/lib/format";
import HomeView from "@/components/HomeView";
import type { HomeTripCard, HomeData } from "@/lib/home-view";

export const revalidate = 300; // content only changes on ingest, not per-request

export default async function HomePage() {
  const [profile, trips] = await Promise.all([
    loadProfile(),
    // Only the fields each stat/card actually renders — the previous
    // `include: { media: true }` pulled every scalar column (sourcePath,
    // width/height, takenAt, lat/lng, the full base64 placeholder...) of
    // every photo of every trip just to pick one cover + one thumb per step.
    prisma.trip.findMany({
      orderBy: { startDate: "desc" },
      select: {
        slug: true,
        title: true,
        startDate: true,
        endDate: true,
        distanceKm: true,
        countryCodes: true,
        coverMediaId: true,
        steps: {
          orderBy: { order: "asc" },
          select: {
            lat: true,
            lng: true,
            order: true,
            locationName: true,
            media: {
              orderBy: { order: "asc" },
              take: 1,
              select: { hash: true },
            },
          },
        },
      },
    }),
  ]);

  // A trip's cover can be any photo in the trip (see trip.json's "cover" key
  // in src/ingest/index.ts), not necessarily a step's first — so it's looked
  // up separately rather than folded into the narrower per-step `take: 1`
  // media query above.
  const coverMediaIds = trips
    .map((t) => t.coverMediaId)
    .filter((id): id is string => id != null);
  const coverHashById = new Map(
    coverMediaIds.length > 0
      ? (
          await prisma.media.findMany({
            where: { id: { in: coverMediaIds } },
            select: { id: true, hash: true },
          })
        ).map((m) => [m.id, m.hash])
      : [],
  );

  const tripCards: HomeTripCard[] = trips.map((trip) => {
    const coverHash =
      (trip.coverMediaId && coverHashById.get(trip.coverMediaId)) ||
      trip.steps[0]?.media[0]?.hash;
    const days = tripDurationDays(trip.startDate, trip.endDate);
    return {
      slug: trip.slug,
      title: trip.title,
      coverUrl: coverHash ? mediaUrl(trip.slug, coverHash, "display") : null,
      subtitleLabel: `${formatMonthYearCaps(trip.startDate)} · ${days} DAYS · ${formatDistance(trip.distanceKm)}`,
    };
  });

  const globeSteps = trips.flatMap((trip) =>
    trip.steps
      .filter((s) => s.media.length > 0)
      .map((s) => ({
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
  const totalCities = uniqueCityCount(trips.flatMap((t) => t.steps));
  const totalKm = Math.round(trips.reduce((n, t) => n + t.distanceKm, 0));
  const totalDays = trips.reduce(
    (n, t) => n + tripDurationDays(t.startDate, t.endDate),
    0,
  );

  const data: HomeData = {
    profile: {
      name: profile.name,
      bio: profile.bio,
      avatarUrl: profile.avatar,
    },
    tripCards,
    globeSteps,
    stats: {
      countries: allCountryCodes.length,
      countryFlags: allCountryCodes.map(countryCodeToFlagEmoji),
      percentOfWorld: percentOfWorldSeen(allCountryCodes),
      totalKmLabel: formatDistance(totalKm),
      totalCities,
      totalDays,
      totalTrips: trips.length,
    },
  };

  return <HomeView data={data} />;
}
