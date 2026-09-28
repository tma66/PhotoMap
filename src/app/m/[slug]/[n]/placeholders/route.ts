import { prisma } from "@/lib/db";

/** Every photo's blur placeholder for one trip, keyed by media hash. Kept
 * out of the trip page itself (which only inlines each step's cover one),
 * so the page — prefetched from every tile that links to it — stays small. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; n: string }> },
) {
  const { slug, n } = await params;
  if (!/^[1-9]\d*$/.test(n)) return new Response("Not found", { status: 404 });
  const media = await prisma.media.findMany({
    where: { step: { trip: { slug, number: Number(n) } } },
    select: { hash: true, placeholder: true },
  });
  return Response.json(
    Object.fromEntries(media.map((m) => [m.hash, m.placeholder])),
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
