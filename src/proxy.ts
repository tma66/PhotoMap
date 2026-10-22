import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isPublicHost, publicRoute } from "@/lib/public-visitor";

/** Public visitors (see src/lib/public-visitor.ts): no API calls, only public
 * trips, and the home page swapped for /public, which lists just those.
 * Pages are built once and shared by both kinds of visitor, so the
 * filtering happens here rather than in them. */
export async function proxy(request: NextRequest) {
  if (!isPublicHost(request.headers.get("host"))) return;

  const route = publicRoute(request.nextUrl.pathname);
  if (route.kind === "forbidden") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (route.kind === "trip") {
    const trip = await prisma.trip.findFirst({
      where: { slug: route.slug, isPublic: true },
      select: { id: true },
    });
    if (!trip) return new NextResponse("Not found", { status: 404 });
  }

  const response =
    route.kind === "home"
      ? NextResponse.rewrite(new URL("/public", request.url))
      : NextResponse.next();
  // The Funnel name is in public certificate logs, so crawlers find it.
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}
