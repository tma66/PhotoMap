import { prisma } from "./db";

/**
 * A trip's card image: its trip.json "cover" photo if set (any photo in the
 * trip — see src/ingest/index.ts), else its first step's first photo.
 * Covers are looked up in one query for every trip passed in, rather than
 * folded into the caller's narrower per-step `take: 1` media query.
 */
export async function resolveCoverHashes<
  T extends {
    coverMediaId: string | null;
    steps: { media: { hash: string }[] }[];
  },
>(trips: T[]): Promise<Map<T, string | undefined>> {
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
  return new Map(
    trips.map((t) => [
      t,
      (t.coverMediaId && coverHashById.get(t.coverMediaId)) ||
        t.steps[0]?.media[0]?.hash,
    ]),
  );
}
