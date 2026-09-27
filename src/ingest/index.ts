// Ingestion entry point: turns assets/<slug>/*.{jpg,heic,...} into rows in
// the SQLite cache (prisma/schema.prisma) plus resized/EXIF-stripped photos
// in data/cache/. Safe to re-run any time — each trip is fully rebuilt from
// its source folder, so the DB is always a pure derivative of assets/. Never
// touches the network itself — weather comes only from what's already cached
// in trip.json's "photos" block (see --photos-template below); a trip with
// no cached weather just has none, rather than fetching it live.
//
// Usage:
//   npm run ingest                              -- ingest every trip once
//   npm run ingest -- --rebuild                 -- wipe the whole DB first, then ingest
//   npm run ingest -- --watch                   -- ingest once, then keep watching assets/
//   npm run ingest -- my-trip-slug               -- ingest just one trip folder
//   npm run ingest -- --photos-template my-trip -- (re)generate one trip's
//   npm run ingest -- --photos-template          -- ...or every trip's
//     trip.json "photos" block: one entry per photo, grouped by its own
//     local calendar date (see src/ingest/timezone.ts) — real EXIF GPS
//     photos get their coord/locationName/weather auto-filled with nothing
//     to do by hand; GPS-less photos need a coord typed in, after which
//     locationName/weather auto-fill too (once network-fetched, this is the
//     only step that talks to the network — see src/ingest/photo-overrides.ts),
//     AND any photo whose local day was previously wrong (e.g. it only had
//     mtime to go on) gets re-filed under the now-correct date. The leading
//     `--` is required (without it, npm won't forward the flag and just
//     runs a plain ingest instead).

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection in ingest:", reason);
  process.exit(1);
});

import "./env"; // must stay the first import — see env.ts
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { basename, join, extname, relative } from "node:path";
import chokidar from "chokidar";
import { prisma } from "../lib/db";
import { downsample } from "../lib/geo";
import {
  isImageExt,
  isVideoExt,
  readMediaMetadata,
  readVideoMetadata,
} from "./exif";
import { mapWithConcurrency } from "./concurrency";
import { localizeInstant } from "./timezone";
import { groupIntoSteps, inferTransportMode, type TaggedMedia } from "./steps";
import { countryCodeForPoint, nearestPlaceName } from "./geocode";
import {
  buildOverrideIndex,
  buildPhotoTemplate,
  findOverride,
  parseCoord,
  type PhotoOverridesByDay,
} from "./photo-overrides";
import { processImage, processVideo } from "./media";
import { fetchHistoricalWeather } from "./weather";
import { tripDistanceKm, uniqueCountryCodes } from "../lib/stats";

const ASSETS_DIR = process.env.ASSETS_DIR ?? "./assets";
const CACHE_DIR = process.env.CACHE_DIR ?? "./data/cache";
const WEATHER_ENABLED = process.env.INGEST_WEATHER !== "off";

interface TripOverrides {
  title?: string;
  description?: string;
  cover?: string;
  stepTitles?: Record<string, string>;
  /** Per-photo manual overrides for missing GPS/location/weather — see
   * src/ingest/photo-overrides.ts. Generate/update with
   * `npm run ingest -- --photos-template <slug>`. */
  photos?: PhotoOverridesByDay;
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

async function loadTaggedMedia(
  tripDir: string,
  photoOverrides: PhotoOverridesByDay | undefined,
): Promise<TaggedMedia[]> {
  const entries = await readdir(tripDir, { withFileTypes: true });
  const files = entries.filter(
    (e) =>
      e.isFile() &&
      (isImageExt(extname(e.name)) || isVideoExt(extname(e.name))), // trip.json, .DS_Store, etc. skipped
  );

  const media = await mapWithConcurrency(
    files,
    async (entry): Promise<TaggedMedia> => {
      const absPath = join(tripDir, entry.name);
      const stats = await stat(absPath);
      const kind: "photo" | "video" = isVideoExt(extname(entry.name))
        ? "video"
        : "photo";
      const meta =
        kind === "video"
          ? await readVideoMetadata(absPath, stats.mtime)
          : await readMediaMetadata(absPath, stats.mtime);
      return { sourcePath: absPath, kind, ...meta };
    },
  );

  // Manual lat/lng overrides feed straight into the same grouping algorithm
  // real GPS does, so a hand-filled-in photo still produces a real per-day
  // route rather than falling back to one shared trip-wide point.
  const overrideIndex = buildOverrideIndex(photoOverrides);
  for (const m of media) {
    const override = findOverride(overrideIndex, basename(m.sourcePath));
    const coord = parseCoord(override?.coord);
    if (coord) {
      m.lat = coord.lat;
      m.lng = coord.lng;
    }
  }

  // A photo with no EXIF date at all falls back to its file's mtime — a
  // real absolute instant, unlike the naive-local-time-as-UTC encoding every
  // EXIF-dated photo uses (see exif.ts). Once its location is known (real
  // GPS, or the hand-typed coord just merged in above), re-express that
  // instant as local time at that coordinate, in the same encoding, so
  // day-grouping treats it like any other photo instead of whatever
  // calendar date it happened to be back at the ingesting machine.
  for (const m of media) {
    if (m.takenAtIsExact && m.lat != null && m.lng != null) {
      m.takenAt = localizeInstant(m.takenAt, { lat: m.lat, lng: m.lng });
    }
  }

  media.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  return media;
}

async function ingestTrip(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  console.log(`[ingest] ${slug}: scanning...`);

  const overrides = await readTripOverrides(tripDir);
  const media = await loadTaggedMedia(tripDir, overrides.photos);

  if (media.length === 0) {
    console.warn(`[ingest] ${slug}: no photos found, skipping`);
    return;
  }

  const draftSteps = groupIntoSteps(media);
  console.log(
    `[ingest] ${slug}: ${media.length} photos -> ${draftSteps.length} steps`,
  );

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
    weatherTempF: number | null;
    weatherCode: number | null;
    mediaFiles: TaggedMedia[];
  }[] = [];

  const overrideIndex = buildOverrideIndex(overrides.photos);

  for (let i = 0; i < draftSteps.length; i++) {
    const step = draftSteps[i]!;
    const prev = draftSteps[i - 1];

    const countryCode = countryCodeForPoint(step.centroid) ?? "";
    // Weather only ever comes from the photo overrides — cached once by
    // `npm run ingest -- --photos-template`, never fetched live here. Temp,
    // code and locationName can each be filled in on different photos within
    // the same step, so they're sourced independently off this one lookup.
    const stepPhotoOverrides = step.media.map((m) =>
      findOverride(overrideIndex, basename(m.sourcePath)),
    );
    const photoLocationOverride = stepPhotoOverrides
      .map((o) => o?.locationName)
      .find((name): name is string => Boolean(name));
    const placeName =
      photoLocationOverride ?? nearestPlaceName(step.centroid, countryCode);
    const override = overrides.stepTitles?.[String(i)];

    // Speed is estimated from the gap between the *last* photo of the
    // departure step and the *first* photo of the arrival step — using
    // `arrivedAt` (the departure step's own first photo) instead would
    // count that entire day's local activity before ever leaving as transit
    // time, deflating the implied speed enough to misclassify a real flight
    // as ground transport.
    const transportMode = prev
      ? inferTransportMode(
          prev.centroid,
          step.centroid,
          prev.media.at(-1)!.takenAt,
          step.arrivedAt,
        )
      : "FOOT";

    const weatherTempF =
      stepPhotoOverrides
        .map((o) => o?.weatherTempF)
        .find((v): v is number => v != null) ?? null;
    const weatherCode =
      stepPhotoOverrides
        .map((o) => o?.weatherCode)
        .find((v): v is number => v != null) ?? null;

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
      weatherTempF,
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

  // Dense trail for the "actual travelled path" ground route, from every
  // geotagged shot in time order.
  const trackPoints = downsample(
    media
      .filter((m) => m.lat != null && m.lng != null)
      .map((m) => ({ t: m.takenAt, lat: m.lat!, lng: m.lng! })),
    500,
  );

  // The expensive part (HEIC conversion + resize, video transcode, or a
  // cache hit's file reads) runs concurrently across every photo/video in
  // the trip, independent of the DB — processImage()/processVideo()
  // themselves skip the work when a file's derivatives are already cached.
  // Flattened across steps (not processed step-by-step) so the concurrency
  // pool stays full even when steps have few files each.
  type MediaJob = { stepIndex: number; mediaIndex: number; m: TaggedMedia };
  const jobs: MediaJob[] = stepInputs.flatMap((input, stepIndex) =>
    input.mediaFiles.map((m, mediaIndex) => ({ stepIndex, mediaIndex, m })),
  );
  const processed = await mapWithConcurrency(jobs, async (job) => {
    try {
      const deriveFn = job.m.kind === "video" ? processVideo : processImage;
      const derivative = await deriveFn(
        job.m.sourcePath,
        join(CACHE_DIR, slug),
      );
      return { job, derivative };
    } catch (err) {
      console.warn(
        `[ingest] ${slug}: failed to process ${job.m.sourcePath}:`,
        err,
      );
      return { job, derivative: undefined };
    }
  });

  // Everything from here is DB-only — wrapped in one transaction so a
  // failure partway through leaves the previous ingest of this trip intact
  // instead of a half-wiped/half-written trip.
  await prisma.$transaction(
    async (tx) => {
      // Wipe and recreate this trip's rows — cascades to Step/Media/TrackPoint.
      await tx.trip.deleteMany({ where: { slug } });

      const trip = await tx.trip.create({
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

      if (trackPoints.length > 0) {
        await tx.trackPoint.createMany({
          data: trackPoints.map((p) => ({ tripId: trip.id, ...p })),
        });
      }

      const createdSteps = await Promise.all(
        stepInputs.map((input) =>
          tx.step.create({
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
              weatherTempF: input.weatherTempF,
              weatherCode: input.weatherCode,
            },
          }),
        ),
      );

      for (const { job, derivative } of processed) {
        if (!derivative) continue;
        const created = await tx.media.create({
          data: {
            stepId: createdSteps[job.stepIndex]!.id,
            type: job.m.kind === "video" ? "VIDEO" : "IMAGE",
            sourcePath: relative(process.cwd(), job.m.sourcePath),
            hash: derivative.hash,
            width: derivative.width,
            height: derivative.height,
            durationSec: derivative.durationSec ?? null,
            takenAt: job.m.takenAt,
            lat: job.m.lat ?? null,
            lng: job.m.lng ?? null,
            placeholder: derivative.placeholder,
            order: job.mediaIndex,
          },
        });
        // trip.json "cover": a filename in the trip folder, e.g. "IMG_0042.HEIC".
        if (overrides.cover && basename(job.m.sourcePath) === overrides.cover) {
          await tx.trip.update({
            where: { id: trip.id },
            data: { coverMediaId: created.id },
          });
        }
      }
    },
    { timeout: 30_000 },
  ); // default 5s can be too short for a large trip's row count

  console.log(
    `[ingest] ${slug}: done (${distanceKm} km, ${countryCodes.length} countries)`,
  );
}

/**
 * Fetches weather for any entry that has a `coord` but is still missing
 * `weatherTempF`/`weatherCode` — done here (network I/O) rather than in
 * `buildPhotoTemplate` (kept pure/offline) — so it's persisted to trip.json
 * once instead of being re-fetched on every regular ingest.
 */
async function fillWeatherOverrides(
  photos: PhotoOverridesByDay,
  media: TaggedMedia[],
): Promise<void> {
  const takenAtByFile = new Map(
    media.map((m) => [basename(m.sourcePath), m.takenAt]),
  );

  const needsWeather = Object.values(photos)
    .flat()
    .filter((entry) => entry.weatherTempF == null || entry.weatherCode == null);

  await mapWithConcurrency(needsWeather, async (entry) => {
    const coord = parseCoord(entry.coord);
    const takenAt = takenAtByFile.get(entry.file);
    if (!coord || !takenAt) return;

    const weather = await fetchHistoricalWeather(coord.lat, coord.lng, takenAt);
    if (weather) {
      entry.weatherTempF ??= weather.tempF;
      entry.weatherCode ??= weather.code;
    }
  });
}

async function writePhotoTemplate(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  const tripJsonPath = join(tripDir, "trip.json");

  const overrides = await readTripOverrides(tripDir);
  const media = await loadTaggedMedia(tripDir, overrides.photos);

  if (media.length === 0) {
    console.warn(`[ingest] ${slug}: no photos found, nothing to template`);
    return;
  }

  const photos = buildPhotoTemplate(media, overrides.photos);
  if (WEATHER_ENABLED) {
    await fillWeatherOverrides(photos, media);
  }
  // Only a missing `coord` needs a human — locationName/weather are always
  // derivable once a coord (real or hand-typed) exists.
  const needingInfo = Object.values(photos).reduce(
    (n, entries) => n + entries.filter((e) => e.coord == null).length,
    0,
  );

  const updated: TripOverrides = { ...overrides, photos };
  await writeFile(tripJsonPath, JSON.stringify(updated, null, 2) + "\n");

  const days = Object.keys(photos).length;
  console.log(
    `[ingest] ${slug}: ${needingInfo} photo(s) still need a coord, across ${days} day(s) — fill in "photos" in ${tripJsonPath}`,
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

  const templateFlagIndex = args.indexOf("--photos-template");
  if (templateFlagIndex !== -1) {
    const slug = args[templateFlagIndex + 1];
    const slugs = slug ? [slug] : await listTripSlugs();
    for (const s of slugs) {
      await writePhotoTemplate(s);
    }
    await prisma.$disconnect();
    return;
  }

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
