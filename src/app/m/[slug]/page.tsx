import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import {
  countryCodeToFlagEmoji,
  formatDayMonth,
  formatDistance,
  formatTravelGap,
  weatherCodeToIcon,
} from "@/lib/format";
import { tripDurationDays } from "@/lib/stats";
import { countryByAlpha2 } from "@/lib/countries";
import { loadProfile } from "@/lib/profile";
import type { StepView, TripView } from "@/lib/trip-view";
import TripView_ from "@/components/TripView";

export const dynamic = "force-dynamic"; // content is edited on disk, not redeployed

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function TripPage({ params }: PageProps) {
  const { slug } = await params;

  const trip = await prisma.trip.findUnique({
    where: { slug },
    include: {
      steps: {
        include: { media: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  });

  if (!trip) notFound();

  const profile = await loadProfile();
  const countryCodes = JSON.parse(trip.countryCodes) as string[];
  const durationDays = tripDurationDays(trip.startDate, trip.endDate);

  const steps: StepView[] = trip.steps.map((step, i) => {
    const prev = trip.steps[i - 1];
    return {
      id: step.id,
      order: step.order,
      dayNumber:
        Math.floor(
          (step.arrivedAt.getTime() - trip.startDate.getTime()) / 86_400_000,
        ) + 1,
      title: step.title,
      locationName: step.locationName,
      countryCode: step.countryCode,
      countryName: countryByAlpha2(step.countryCode)?.name ?? "",
      flag: countryCodeToFlagEmoji(step.countryCode),
      dateLabel: formatDayMonth(step.arrivedAt),
      weatherIcon: weatherCodeToIcon(step.weatherCode),
      weatherTempC: step.weatherTempC,
      lat: step.lat,
      lng: step.lng,
      arrivedAtISO: step.arrivedAt.toISOString(),
      transportMode: step.transportMode,
      journalText: step.journalText,
      travelGapLabel: prev
        ? formatTravelGap(prev.arrivedAt.getTime(), step.arrivedAt.getTime())
        : null,
      isLatest: i === trip.steps.length - 1,
      media: step.media.map((m) => ({
        hash: m.hash,
        type: m.type as "IMAGE" | "VIDEO",
        thumbUrl: mediaUrl(slug, m.hash, "thumb"),
        displayUrl: mediaUrl(slug, m.hash, "display"),
        placeholder: m.placeholder,
        durationSec: m.durationSec,
      })),
    };
  });

  const trackPoints = await prisma.trackPoint.findMany({
    where: { tripId: trip.id },
    orderBy: { t: "asc" },
  });

  const view: TripView = {
    slug,
    title: trip.title,
    description: trip.description,
    ownerName: profile.name,
    ownerAvatarUrl: profile.avatar,
    flags: countryCodes.map(countryCodeToFlagEmoji),
    statsLabel: `${durationDays} day${durationDays === 1 ? "" : "s"} · ${steps.length} step${steps.length === 1 ? "" : "s"} · ${formatDistance(trip.distanceKm)}`,
    steps,
    trackPoints: trackPoints.map((p) => ({
      tISO: p.t.toISOString(),
      lat: p.lat,
      lng: p.lng,
    })),
  };

  return <TripView_ trip={view} />;
}
