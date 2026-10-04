// Tells the running site that trip data changed (see
// src/app/api/revalidate/route.ts), then loads every page once so the next
// visitor gets an already-rendered page.
import { prisma } from "../lib/db";
import { ensureRevalidateToken } from "../lib/revalidate-token";

const SITE_URL = process.env.SITE_URL || "http://localhost:3000";

export async function refreshSite(): Promise<void> {
  try {
    const token = await ensureRevalidateToken();
    const res = await fetch(`${SITE_URL}/api/revalidate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn(
      `[ingest] couldn't refresh the site at ${SITE_URL} (${(err as Error).message}); it'll show the new data after its next restart + build`,
    );
    return;
  }

  const trips = await prisma.trip.findMany({
    select: { slug: true, number: true },
  });
  const paths = [
    "/",
    ...new Set(trips.map((t) => `/m/${t.slug}`)),
    ...trips.map((t) => `/m/${t.slug}/${t.number}`),
  ];
  // Each body is read to the end: that's when the page has finished
  // rendering, and an unread body holds its connection (and with it this
  // process) open for several seconds after ingest is done.
  await Promise.all(
    paths.map((p) =>
      fetch(SITE_URL + p, { signal: AbortSignal.timeout(30_000) })
        .then((r) => r.arrayBuffer())
        .catch(() => {}),
    ),
  );
  console.log(`[ingest] site refreshed (${paths.length} pages)`);
}
