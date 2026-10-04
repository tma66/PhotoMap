import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import { resolveCoverHashes } from "@/lib/trip-cover";
import { zoomName } from "@/lib/page-transition";
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
import { isHeaven } from "@/lib/heaven";
import HomeView from "@/components/HomeView";
import type { HomeTripCard, HomeData, HomeGlobeStep } from "@/lib/home-view";

export default async function HomePage() {
  const [profile, trips] = await Promise.all([
    loadProfile(),
    // Only the fields each stat/card actually renders — the previous
    // `include: { media: true }` pulled every scalar column (sourcePath,
    // width/height, takenAt, lat/lng, the full base64 placeholder...) of
    // every photo of every trip just to pick one cover + one thumb per step.
    prisma.trip.findMany({
      // The bundled demo folder stays reachable at /m/example but isn't listed.
      where: { slug: { not: "example" } },
      orderBy: { startDate: "desc" },
      select: {
        slug: true,
        number: true,
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
            cityName: true,
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

  const coverHashes = await resolveCoverHashes(trips);

  // One card per assets/ folder. `trips` is newest first, so a folder's
  // first trip seen is its latest — that orders the cards and supplies the
  // cover. A folder holding several trips shows just its name and opens its
  // trip selector (/m/<slug>) instead of a single trip page.
  const tripsBySlug = new Map<string, typeof trips>();
  for (const trip of trips) {
    const folder = tripsBySlug.get(trip.slug);
    if (folder) folder.push(trip);
    else tripsBySlug.set(trip.slug, [trip]);
  }
  const tripCards: HomeTripCard[] = [...tripsBySlug].map(([slug, folder]) => {
    const latest = folder[0]!;
    const coverHash = coverHashes.get(latest);
    const days = tripDurationDays(latest.startDate, latest.endDate);
    const isMultiTrip = folder.length > 1;
    return {
      slug,
      href: isMultiTrip ? `/m/${slug}` : `/m/${slug}/${latest.number}`,
      zoomName: isMultiTrip ? null : zoomName(slug, latest.number),
      title: latest.title,
      coverUrl: coverHash ? mediaUrl(slug, coverHash, "card") : null,
      subtitleLabel: isMultiTrip
        ? null
        : `${formatMonthYearCaps(latest.startDate)} · ${days} DAYS · ${formatDistance(latest.distanceKm)}`,
    };
  });

  // One pin per spot (~100 m): pins stacked on the same place look like the
  // top one anyway, so only the last (drawn on top) is kept — instead of
  // several hundred markers and thumbnails, most of them hidden.
  const globePins = new Map<string, HomeGlobeStep>();
  for (const trip of trips) {
    for (const s of trip.steps) {
      if (s.media.length === 0 || isHeaven(s)) continue;
      const spot = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
      globePins.delete(spot); // re-inserted last, keeping the drawing order
      globePins.set(spot, {
        lat: s.lat,
        lng: s.lng,
        pinUrl: mediaUrl(trip.slug, s.media[0]!.hash, "pin"),
        tripId: `${trip.slug}/${trip.number}`,
      });
    }
  }
  const globeSteps = [...globePins.values()];

  const allCountryCodes = [
    ...new Set(trips.flatMap((t) => JSON.parse(t.countryCodes) as string[])),
  ];
  const totalCities = uniqueCityCount(
    trips.flatMap((t) => t.steps).filter((s) => !isHeaven(s)),
  );
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
