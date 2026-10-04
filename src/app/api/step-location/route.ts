import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";

const run = promisify(execFile);
const TSX_CLI = resolve(
  /* turbopackIgnore: true */ "./node_modules/tsx/dist/cli.mjs",
);

// One save at a time: each rewrites trip.json and re-ingests the trip.
let queue: Promise<unknown> = Promise.resolve();

const isCoord = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;

/** The trip page's "change location" picker: moves every photo in a step to
 * one coord (ingest's --move-step, which updates trip.json and the DB, then
 * refreshes the site's cached pages). Only the step's own photos can be
 * touched — the folder and filenames come from the DB, not the request. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    stepId?: unknown;
    lat?: unknown;
    lng?: unknown;
  } | null;
  const { stepId, lat, lng } = body ?? {};
  if (typeof stepId !== "string" || !isCoord(lat, 90) || !isCoord(lng, 180)) {
    return new Response("Bad request", { status: 400 });
  }

  const step = await prisma.step.findUnique({
    where: { id: stepId },
    select: { id: true },
  });
  if (!step) return new Response("Step not found", { status: 404 });

  const coord = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const job = queue.then(() =>
    run(
      process.execPath,
      [TSX_CLI, "src/ingest/index.ts", "--move-step", step.id, coord],
      { maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  queue = job.catch(() => {});

  try {
    await job;
  } catch (err) {
    console.error("[step-location] ingest failed:", err);
    return new Response("Couldn't save the new location", { status: 500 });
  }
  return Response.json({ ok: true });
}
