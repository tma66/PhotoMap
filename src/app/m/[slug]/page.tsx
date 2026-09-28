import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { mediaUrl } from "@/lib/media-url";
import { loadProfile } from "@/lib/profile";
import { resolveCoverHashes } from "@/lib/trip-cover";
import { formatDistance, formatMonthYear } from "@/lib/format";
import { tripDurationDays } from "@/lib/stats";
import { zoomName } from "@/lib/page-transition";
import type { TripSelectorData } from "@/lib/trip-view";
import TripSelector from "@/components/TripSelector";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Prerendered for the same reason as the trip page — see [n]/page.tsx.
export async function generateStaticParams() {
  const trips = await prisma.trip.findMany({
    distinct: ["slug"],
    select: { slug: true },
  });
  return trips.map((t) => ({ slug: t.slug }));
}

/** One folder under assets/ — a tile per trip when it holds several, or
 * straight through to the trip page when it holds just one (which also
 * keeps pre-multi-trip /m/<slug> links and NFC tags working). */
export default async function TripSelectorPage({ params }: PageProps) {
  const { slug } = await params;

  const [profile, trips] = await Promise.all([
    loadProfile(),
    prisma.trip.findMany({
      where: { slug },
      orderBy: { number: "asc" },
      select: {
        number: true,
        title: true,
        startDate: true,
        endDate: true,
        distanceKm: true,
        coverMediaId: true,
        steps: {
          orderBy: { order: "asc" },
          take: 1,
          select: {
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

  if (trips.length === 0) notFound();
  // Not always 1: a trip with no placeable photos is skipped at ingest
  // without renumbering the others.
  if (trips.length === 1) redirect(`/m/${slug}/${trips[0]!.number}`);

  const coverHashes = await resolveCoverHashes(trips);

  const data: TripSelectorData = {
    title: trips[0]!.title,
    path: `/m/${slug}`,
    owner: { name: profile.name, avatarUrl: profile.avatar },
    tiles: trips.map((trip) => {
      const coverHash = coverHashes.get(trip);
      const days = tripDurationDays(trip.startDate, trip.endDate);
      return {
        href: `/m/${slug}/${trip.number}`,
        zoomName: zoomName(slug, trip.number),
        coverUrl: coverHash ? mediaUrl(slug, coverHash, "card") : null,
        title: formatMonthYear(trip.startDate),
        subtitleLabel: `${days} DAY${days === 1 ? "" : "S"} · ${formatDistance(trip.distanceKm)}`,
      };
    }),
  };

  return <TripSelector data={data} />;
}
