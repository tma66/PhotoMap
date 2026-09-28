import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import {
  countryCodeToFlagEmoji,
  formatBookendDate,
  formatDayMonth,
  formatDistance,
  weatherCodeToIcon,
} from "@/lib/format";
import { dayNumber, tripDurationDays, uniqueCityCount } from "@/lib/stats";
import { countryByAlpha2 } from "@/lib/countries";
import { zoomName } from "@/lib/page-transition";
import type { StepView, TripView } from "@/lib/trip-view";
import TripView_ from "@/components/TripView";

interface PageProps {
  params: Promise<{ slug: string; n: string }>;
}

// Prerendered (and so fully prefetchable) rather than rendered on demand —
// otherwise a tap waits on the server with the old page still up. Trips
// ingested after the build still render on first visit, then get cached.
export async function generateStaticParams() {
  const trips = await prisma.trip.findMany({
    select: { slug: true, number: true },
  });
  return trips.map((t) => ({ slug: t.slug, n: String(t.number) }));
}

export default async function TripPage({ params }: PageProps) {
  const { slug, n } = await params;
  if (!/^[1-9]\d*$/.test(n)) notFound();
  const number = Number(n);

  // Trip, track points and the folder's trip count don't depend on each
  // other — fetched in parallel via the slug relation rather than waiting
  // for `trip.id` first. `select` (not `include`) also drops columns the
  // page never reads (sourcePath, width/height, takenAt/lat/lng on Media —
  // the client gets a step's own lat/lng, not each photo's).
  const [profile, trip, trackPoints, tripsInFolder] = await Promise.all([
    loadProfile(),
    prisma.trip.findUnique({
      where: { slug_number: { slug, number } },
      select: {
        title: true,
        startDate: true,
        endDate: true,
        distanceKm: true,
        countryCodes: true,
        steps: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            locationName: true,
            countryCode: true,
            lat: true,
            lng: true,
            arrivedAt: true,
            transportMode: true,
            journalText: true,
            weatherTempF: true,
            weatherCode: true,
            media: {
              orderBy: { order: "asc" },
              select: {
                hash: true,
                placeholder: true,
                type: true,
                durationSec: true,
              },
            },
          },
        },
      },
    }),
    prisma.trackPoint.findMany({
      where: { trip: { slug, number } },
      orderBy: { t: "asc" },
      select: { t: true, lat: true, lng: true },
    }),
    prisma.trip.count({ where: { slug } }),
  ]);

  if (!trip) notFound();

  const countryCodes = JSON.parse(trip.countryCodes) as string[];
  const durationDays = tripDurationDays(trip.startDate, trip.endDate);

  const steps: StepView[] = trip.steps.map((step) => {
    return {
      id: step.id,
      dayNumber: dayNumber(step.arrivedAt, trip.startDate),
      title: step.title,
      locationName: step.locationName,
      countryCode: step.countryCode,
      countryName: countryByAlpha2(step.countryCode)?.name ?? "",
      flag: countryCodeToFlagEmoji(step.countryCode),
      dateLabel: formatDayMonth(step.arrivedAt),
      weatherIcon: weatherCodeToIcon(step.weatherCode),
      weatherTempF: step.weatherTempF,
      lat: step.lat,
      lng: step.lng,
      arrivedAtISO: step.arrivedAt.toISOString(),
      transportMode: step.transportMode,
      journalText: step.journalText,
      media: step.media.map((m, i) => ({
        hash: m.hash,
        type: m.type as "IMAGE" | "VIDEO",
        thumbUrl: mediaUrl(slug, m.hash, "thumb"),
        displayUrl: mediaUrl(slug, m.hash, "display"),
        videoUrl: m.type === "VIDEO" ? mediaUrl(slug, m.hash, "video") : null,
        durationSec: m.durationSec,
        placeholder: i === 0 ? m.placeholder : null,
      })),
    };
  });

  const cityCount = uniqueCityCount(steps);

  const view: TripView = {
    title: trip.title,
    // Back to this folder's trip selector when there's one to go back to.
    backHref: tripsInFolder > 1 ? `/m/${slug}` : "/",
    path: `/m/${slug}/${number}`,
    zoomName: zoomName(slug, number),
    owner: { name: profile.name, avatarUrl: profile.avatar },
    flags: countryCodes.map(countryCodeToFlagEmoji),
    statsLabel: `${durationDays} day${durationDays === 1 ? "" : "s"} · ${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${formatDistance(trip.distanceKm)}`,
    startDateLabel: formatBookendDate(trip.startDate),
    endDateLabel: formatBookendDate(trip.endDate),
    steps,
    trackPoints: trackPoints.map((p) => ({
      tISO: p.t.toISOString(),
      lat: p.lat,
      lng: p.lng,
    })),
  };

  return <TripView_ trip={view} />;
}
