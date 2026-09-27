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
import type { StepView, TripView } from "@/lib/trip-view";
import TripView_ from "@/components/TripView";

export const revalidate = 300; // content only changes on ingest, not per-request

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function TripPage({ params }: PageProps) {
  const { slug } = await params;

  // Trip and track points don't depend on each other — fetched in parallel
  // via the slug relation rather than waiting for `trip.id` first. `select`
  // (not `include`) also drops columns the page never reads (sourcePath,
  // width/height, takenAt/lat/lng on Media — the client gets a step's own
  // lat/lng, not each photo's).
  const [profile, trip, trackPoints] = await Promise.all([
    loadProfile(),
    prisma.trip.findUnique({
      where: { slug },
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
      where: { trip: { slug } },
      orderBy: { t: "asc" },
      select: { t: true, lat: true, lng: true },
    }),
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
      media: step.media.map((m) => ({
        hash: m.hash,
        type: m.type as "IMAGE" | "VIDEO",
        thumbUrl: mediaUrl(slug, m.hash, "thumb"),
        displayUrl: mediaUrl(slug, m.hash, "display"),
        videoUrl: m.type === "VIDEO" ? mediaUrl(slug, m.hash, "video") : null,
        durationSec: m.durationSec,
        placeholder: m.placeholder,
      })),
    };
  });

  const cityCount = uniqueCityCount(steps);

  const view: TripView = {
    title: trip.title,
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
