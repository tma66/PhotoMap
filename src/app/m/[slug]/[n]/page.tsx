import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import {
  countryCodeToFlagEmoji,
  formatBookendDate,
  formatDayMonth,
  formatDistance,
  formatMonthYear,
  weatherCodeToIcon,
} from "@/lib/format";
import { dayNumber, tripDurationDays, uniqueCityCount } from "@/lib/stats";
import { countryByAlpha2 } from "@/lib/countries";
import { zoomName } from "@/lib/page-transition";
import type { StepView, TripView } from "@/lib/trip-view";
import {
  HEAVEN_BADGE,
  HEAVEN_END_LABEL,
  HEAVEN_SUBTITLE,
  isHeaven,
} from "@/lib/heaven";
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

  // Trip and the folder's trip count don't depend on each
  // other — fetched in parallel via the slug relation rather than waiting
  // for `trip.id` first. `select` (not `include`) also drops columns the
  // page never reads (sourcePath, width/height, takenAt/lat/lng on Media —
  // the client gets a step's own lat/lng, not each photo's).
  const [profile, trip, tripsInFolder] = await Promise.all([
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
            cityName: true,
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
    prisma.trip.count({ where: { slug } }),
  ]);

  if (!trip) notFound();

  const countryCodes = JSON.parse(trip.countryCodes) as string[];
  const durationDays = tripDurationDays(trip.startDate, trip.endDate);

  const steps: StepView[] = trip.steps.map((step) => {
    const heaven = isHeaven(step); // see src/lib/heaven.ts
    return {
      id: step.id,
      dayNumber: dayNumber(step.arrivedAt, trip.startDate),
      title: step.title,
      locationName: step.locationName,
      cityName: step.cityName,
      countryCode: step.countryCode,
      countryName: heaven
        ? HEAVEN_SUBTITLE
        : (countryByAlpha2(step.countryCode)?.name ?? ""),
      flag: heaven ? HEAVEN_BADGE : countryCodeToFlagEmoji(step.countryCode),
      heaven,
      dateLabel: formatDayMonth(step.arrivedAt),
      weatherIcon: weatherCodeToIcon(step.weatherCode),
      weatherTempF: step.weatherTempF,
      lat: step.lat,
      lng: step.lng,
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

  const cityCount = uniqueCityCount(steps.filter((s) => !s.heaven));

  const isMultiTrip = tripsInFolder > 1;
  const flags = countryCodes.map(countryCodeToFlagEmoji);
  const endsInHeaven = steps.at(-1)?.heaven ?? false;
  const view: TripView = {
    // In a folder of several trips, the date tells them apart ("EDC May
    // 2024", matching its tile on the selector).
    title: isMultiTrip
      ? `${trip.title} ${formatMonthYear(trip.startDate)}`
      : trip.title,
    // Back to this folder's trip selector when there's one to go back to.
    backHref: isMultiTrip ? `/m/${slug}` : "/",
    path: `/m/${slug}/${number}`,
    zoomName: zoomName(slug, number),
    owner: { name: profile.name, avatarUrl: profile.avatar },
    flags,
    titleFlags: endsInHeaven ? [HEAVEN_BADGE] : flags,
    statsLabel: `${durationDays} day${durationDays === 1 ? "" : "s"} · ${cityCount} ${cityCount === 1 ? "city" : "cities"} · ${formatDistance(trip.distanceKm)}`,
    startDateLabel: formatBookendDate(trip.startDate),
    endCard: endsInHeaven
      ? { label: HEAVEN_END_LABEL, dateLabel: null, flags: [HEAVEN_BADGE] }
      : {
          label: "Trip finished",
          dateLabel: formatBookendDate(trip.endDate),
          flags,
        },
    steps,
  };

  return <TripView_ trip={view} />;
}
