import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { readRevalidateToken } from "@/lib/revalidate-token";

/** Called by ingest after it rewrites the DB: drops every cached page so
 * the next visit renders from the new data. Pages are otherwise built once
 * and never refreshed on a timer. */
export async function POST(request: Request) {
  const token = await readRevalidateToken();
  const given = Buffer.from(
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
  );
  const expected = Buffer.from(token ?? "");
  if (
    !token ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  revalidatePath("/", "layout");
  return Response.json({ revalidated: true });
}
