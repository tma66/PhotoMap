// Ingestion entry point: turns assets/<slug>/*.{jpg,heic,...} into rows in
// the SQLite cache (prisma/schema.prisma) plus resized/EXIF-stripped photos
// in data/cache/. Safe to re-run any time — each trip is fully rebuilt from
// its source folder, so the DB is always a pure derivative of assets/.
//
// Usage:
//   npm run ingest                 -- ingest every trip once
//   npm run ingest -- --rebuild    -- wipe the whole DB first, then ingest
//   npm run ingest -- --watch      -- ingest once, then keep watching assets/
//   npm run ingest -- my-trip-slug -- ingest just one trip folder

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection in ingest:", reason);
  process.exit(1);
});

import "./env"; // must stay the first import — see env.ts
import { readdir, stat, readFile } from "node:fs/promises";
import { basename, join, extname, relative } from "node:path";
import chokidar from "chokidar";
import { prisma } from "../lib/db";
import { downsample } from "../lib/geo";
import { mediaTypeForExt, readMediaMetadata } from "./exif";
import { groupIntoSteps, inferTransportMode, type TaggedMedia } from "./steps";
import { countryCodeForPoint, nearestPlaceName } from "./geocode";
import { processImage } from "./media";
import { fetchHistoricalWeather } from "./weather";
import { tripDistanceKm, uniqueCountryCodes } from "../lib/stats";
import sharp from "sharp";

const ASSETS_DIR = process.env.ASSETS_DIR ?? "./assets";
const CACHE_DIR = process.env.CACHE_DIR ?? "./data/cache";
const WEATHER_ENABLED = process.env.INGEST_WEATHER !== "off";

interface TripOverrides {
  title?: string;
  description?: string;
  cover?: string;
  stepTitles?: Record<string, string>;
}

async function listTripSlugs(): Promise<string[]> {
  const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function readTripOverrides(tripDir: string): Promise<TripOverrides> {
  try {
    const raw = await readFile(join(tripDir, "trip.json"), "utf8");
    return JSON.parse(raw) as TripOverrides;
  } catch {
    return {};
  }
}

async function loadTaggedMedia(tripDir: string): Promise<TaggedMedia[]> {
  const entries = await readdir(tripDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile());

  const media: TaggedMedia[] = [];
  for (const entry of files) {
    const ext = extname(entry.name);
    const type = mediaTypeForExt(ext);
    if (!type) continue; // trip.json, .DS_Store, etc.
    if (type === "VIDEO") continue; // phase 2 — schema is ready, ingestion isn't yet

    const absPath = join(tripDir, entry.name);
    const stats = await stat(absPath);
    const meta = await readMediaMetadata(absPath, stats.mtime);

    // Dimensions are filled in properly during image processing; a cheap
    // probe here just lets grouping run without waiting on full resize work.
    let width = 0;
    let height = 0;
    try {
      const probe = await sharp(await readFile(absPath)).metadata();
      width = probe.width ?? 0;
      height = probe.height ?? 0;
    } catch {
      // HEIC can't be probed by sharp directly; real dimensions come from
      // processImage() later. 0x0 here is harmless in the meantime.
    }

    media.push({ sourcePath: absPath, type, width, height, ...meta });
  }

  media.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  return media;
}

async function ingestTrip(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  console.log(`[ingest] ${slug}: scanning...`);

  const [overrides, media] = await Promise.all([
    readTripOverrides(tripDir),
    loadTaggedMedia(tripDir),
  ]);

  if (media.length === 0) {
    console.warn(`[ingest] ${slug}: no photos found, skipping`);
    return;
  }

  const draftSteps = groupIntoSteps(media);
  console.log(
    `[ingest] ${slug}: ${media.length} photos -> ${draftSteps.length} steps`,
  );

  // Wipe and recreate this trip's rows — cascades to Step/Media/TrackPoint.
  await prisma.trip.deleteMany({ where: { slug } });

  const stepInputs: {
    order: number;
    title: string;
    locationName: string;
    countryCode: string;
    lat: number;
    lng: number;
    arrivedAt: Date;
    journalText: string;
    transportMode: string;
    weatherTempC: number | null;
    weatherCode: number | null;
    mediaFiles: TaggedMedia[];
  }[] = [];

  for (let i = 0; i < draftSteps.length; i++) {
    const step = draftSteps[i]!;
    const prev = draftSteps[i - 1];

    const countryCode = countryCodeForPoint(step.centroid) ?? "";
    const placeName = nearestPlaceName(step.centroid, countryCode);
    const override = overrides.stepTitles?.[String(i)];

    const transportMode = prev
      ? inferTransportMode(
          prev.centroid,
          step.centroid,
          prev.arrivedAt,
          step.arrivedAt,
        )
      : "FOOT";

    let weatherTempC: number | null = null;
    let weatherCode: number | null = null;
    if (WEATHER_ENABLED) {
      const weather = await fetchHistoricalWeather(
        step.centroid.lat,
        step.centroid.lng,
        step.arrivedAt,
      );
      if (weather) {
        weatherTempC = weather.tempC;
        weatherCode = weather.code;
      }
    }

    stepInputs.push({
      order: i,
      title: override ?? placeName,
      locationName: placeName,
      countryCode,
      lat: step.centroid.lat,
      lng: step.centroid.lng,
      arrivedAt: step.arrivedAt,
      journalText: step.captions.join("\n\n"),
      transportMode,
      weatherTempC,
      weatherCode,
      mediaFiles: step.media,
    });
  }

  // Span of the photos themselves, not of step arrivals — the last step can
  // last several days after you arrive.
  const startDate = media[0]!.takenAt;
  const endDate = media.at(-1)!.takenAt;
  const distanceKm = tripDistanceKm(stepInputs);
  const countryCodes = uniqueCountryCodes(stepInputs);

  const trip = await prisma.trip.create({
    data: {
      slug,
      title: overrides.title ?? humanizeSlug(slug),
      description: overrides.description ?? "",
      startDate,
      endDate,
      distanceKm,
      countryCodes: JSON.stringify(countryCodes),
    },
  });

  // Dense trail for the "actual travelled path" ground route, from every
  // geotagged shot in time order (optional .gpx import is a later addition).
  const trackPoints = downsample(
    media
      .filter((m) => m.lat != null && m.lng != null)
      .map((m) => ({ t: m.takenAt, lat: m.lat!, lng: m.lng! })),
    500,
  );
  if (trackPoints.length > 0) {
    await prisma.trackPoint.createMany({
      data: trackPoints.map((p) => ({ tripId: trip.id, ...p })),
    });
  }

  for (const input of stepInputs) {
    const createdStep = await prisma.step.create({
      data: {
        tripId: trip.id,
        order: input.order,
        title: input.title,
        locationName: input.locationName,
        countryCode: input.countryCode,
        lat: input.lat,
        lng: input.lng,
        arrivedAt: input.arrivedAt,
        journalText: input.journalText,
        transportMode: input.transportMode,
        weatherTempC: input.weatherTempC,
        weatherCode: input.weatherCode,
      },
    });

    let mediaOrder = 0;
    for (const m of input.mediaFiles) {
      try {
        const derivative = await processImage(
          m.sourcePath,
          join(CACHE_DIR, slug),
        );
        const created = await prisma.media.create({
          data: {
            stepId: createdStep.id,
            type: "IMAGE",
            sourcePath: relative(process.cwd(), m.sourcePath),
            hash: derivative.hash,
            width: derivative.width,
            height: derivative.height,
            takenAt: m.takenAt,
            lat: m.lat ?? null,
            lng: m.lng ?? null,
            placeholder: derivative.placeholder,
            order: mediaOrder++,
          },
        });
        // trip.json "cover": a filename in the trip folder, e.g. "IMG_0042.HEIC".
        if (overrides.cover && basename(m.sourcePath) === overrides.cover) {
          await prisma.trip.update({
            where: { id: trip.id },
            data: { coverMediaId: created.id },
          });
        }
      } catch (err) {
        console.warn(
          `[ingest] ${slug}: failed to process ${m.sourcePath}:`,
          err,
        );
      }
    }
  }

  console.log(
    `[ingest] ${slug}: done (${distanceKm} km, ${countryCodes.length} countries)`,
  );
}

async function ingestAll(onlySlug?: string): Promise<void> {
  const slugs = onlySlug ? [onlySlug] : await listTripSlugs();
  for (const slug of slugs) {
    try {
      await ingestTrip(slug);
    } catch (err) {
      console.error(`[ingest] ${slug}: failed`, err);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rebuild = args.includes("--rebuild");
  const watch = args.includes("--watch");
  const onlySlug = args.find((a) => !a.startsWith("--"));

  if (rebuild) {
    console.log("[ingest] --rebuild: wiping database");
    await prisma.trackPoint.deleteMany();
    await prisma.media.deleteMany();
    await prisma.step.deleteMany();
    await prisma.trip.deleteMany();
  }

  await ingestAll(onlySlug);

  if (watch) {
    console.log(`[ingest] watching ${ASSETS_DIR} for changes...`);
    const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const scheduleIngest = (slug: string) => {
      const existing = debounceTimers.get(slug);
      if (existing) clearTimeout(existing);
      debounceTimers.set(
        slug,
        setTimeout(() => {
          debounceTimers.delete(slug);
          ingestTrip(slug).catch((err) =>
            console.error(`[ingest] ${slug}: failed`, err),
          );
        }, 2000),
      );
    };

    chokidar
      .watch(ASSETS_DIR, { ignoreInitial: true, depth: 2 })
      .on("all", (_event, path) => {
        const rel = relative(ASSETS_DIR, path);
        const slug = rel.split("/")[0];
        if (slug && !slug.startsWith(".")) scheduleIngest(slug);
      });
  } else {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[ingest] fatal:", err);
  process.exit(1);
});
