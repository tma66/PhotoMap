// Ingestion entry point: turns assets/<slug>/*.{jpg,heic,...} into rows in
// the SQLite cache (prisma/schema.prisma) plus resized/EXIF-stripped photos
// in data/cache/. Safe to re-run any time — each trip is fully rebuilt from
// its source folder, so the DB is always a pure derivative of assets/. Never
// touches the network itself — weather comes only from what's already cached
// in trip.json's "photos" block (see --photos-template below); a trip with
// no cached weather just has none, rather than fetching it live. One folder
// can hold several trips, one per numbered subfolder (assets/EDC/1/,
// assets/EDC/3/ — the name is the trip's number and URL); a folder with just
// photos in it is a single trip #1. See listTrips below.
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
//     to do by hand; a GPS-less photo with no coord takes the nearest-in-time
//     coord on its date (none on a copy-date photo, or a day with no coords),
//     else needs one typed in, after which
//     locationName/weather auto-fill too (this and the site's --move-step
//     are the only steps that fetch weather — see src/ingest/photo-overrides.ts),
//     AND an entry filed under a date other than its file's recorded one
//     (up to 7 days off; see misfiledMoves) moves to it, a hand-typed coord
//     becoming the nearest unmoved item's (within 6 h), weather refetched; copy-date (mtime) files,
//     and entries further off, stay where they're filed. Each date's entries
//     are sorted by time, and trip.json.<timestamp>.bak is kept when the
//     file changes. Each affected trip is then re-ingested into the DB, so the site reflects
//     the refreshed trip.json (and any photos removed from assets/) right
//     away. The leading `--` is required (without it, npm won't forward the
//     flag and just runs a plain ingest instead).
//   npm run ingest -- --refresh-weather my-trip -- refetch one trip's
//   npm run ingest -- --refresh-weather          -- ...or every trip's
//     weather in trip.json, replacing what's there (for when weather.ts
//     changes how it sums up a day). Nothing else in trip.json changes, and
//     the old file is kept beside it as trip.json.<timestamp>.bak.
//   npm run ingest -- --rename old-slug new-slug -- rename a trip folder (its
//     URL) and its cache folder, drop the old name's DB rows and ingest the
//     new one; nothing is re-encoded. NFC tags with the old URL need rewriting.
//   npm run ingest -- --find-duplicates my-trip -- list one trip's (or,
//     with no slug, every trip's) exact and near-duplicate photos within
//     each trip (videos skipped) — see src/ingest/duplicates.ts. Report
//     only: files, trip.json and the DB are left alone.

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection in ingest:", reason);
  process.exit(1);
});

import "./env"; // must stay the first import — see env.ts
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, join, extname, relative } from "node:path";
import chokidar from "chokidar";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import {
  isImageExt,
  isVideoExt,
  readMediaMetadata,
  readVideoMetadata,
} from "./exif";
import { mapWithConcurrency } from "./concurrency";
import { localizeByNearestOffset, localizeInstant } from "./timezone";
import { groupIntoSteps, inferTransportMode, type TaggedMedia } from "./steps";
import { cityNameFor, countryCodeForPoint, nearestPlaceName } from "./geocode";
import {
  allEntries,
  DAY_MS,
  namesFor,
  buildOverrideIndex,
  buildPhotoTemplate,
  dayGroups,
  filedDates,
  moveEntries,
  parseCoord,
  refreshChangedCoords,
  sortEntriesByTime,
  isSameCoord,
  nearestCoord,
  misfiledMoves,
  type PhotoOverridesByDay,
  type PhotosBlock,
} from "./photo-overrides";
import { processImage, processVideo, saveSourceIndex } from "./media";
import { findDuplicateGroups, perceptualHash } from "./duplicates";
import { refreshSite } from "./site-refresh";
import { fetchHistoricalWeather } from "./weather";
import { tripDistanceKm, uniqueCountryCodes } from "../lib/stats";
import { HEAVEN_PLACE, heavenName, isHeaven } from "../lib/heaven";
import { SAFE_SLUG } from "../lib/media-path-safety";

const ASSETS_DIR = process.env.ASSETS_DIR ?? "./assets";
const CACHE_DIR = process.env.CACHE_DIR ?? "./data/cache";
const WEATHER_ENABLED = process.env.INGEST_WEATHER !== "off";
const TRIP_DIR_NAME = /^[1-9]\d*$/; // a trip subfolder: "1", "3", ...

// trip.json, .DS_Store, etc. aren't media.
const isMediaFile = (name: string) =>
  isImageExt(extname(name)) || isVideoExt(extname(name));

const tripLabel = (slug: string, number: number, isMultiTrip: boolean) =>
  isMultiTrip ? `${slug} #${number}` : slug;

interface TripOverrides {
  title?: string;
  description?: string;
  cover?: string;
  /** Keyed by step index — or, in a folder holding several trips, by trip
   * number first: { "2": { "0": "Kyoto" } }. */
  stepTitles?: Record<string, string | Record<string, string>>;
  /** Per-photo manual overrides for missing GPS/location/weather — see
   * src/ingest/photo-overrides.ts. Generate/update with
   * `npm run ingest -- --photos-template <slug>`. */
  photos?: PhotosBlock;
}

function stepTitleOverride(
  stepTitles: TripOverrides["stepTitles"],
  tripNumber: number,
  isMultiTrip: boolean,
  stepIndex: number,
): string | undefined {
  const scoped = isMultiTrip ? stepTitles?.[String(tripNumber)] : stepTitles;
  if (!scoped || typeof scoped !== "object") return undefined;
  const title = (scoped as Record<string, unknown>)[String(stepIndex)];
  return typeof title === "string" ? title : undefined;
}

async function listTripSlugs(): Promise<string[]> {
  const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

interface TripSource {
  number: number;
  dir: string;
}

/**
 * The trips in one assets/ folder: one per positive-integer subfolder
 * (`assets/EDC/3/` is trip 3), or — when there are none — the folder itself
 * as trip 1. `isMultiTrip` (subfolder mode) also decides trip.json's layout:
 * `photos`/`stepTitles` nested by trip number rather than flat.
 */
async function listTrips(
  slug: string,
): Promise<{ isMultiTrip: boolean; trips: TripSource[] }> {
  const folder = join(ASSETS_DIR, slug);
  const entries = await readdir(folder, { withFileTypes: true });
  const subdirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("."),
  );
  const trips = subdirs
    .filter((e) => TRIP_DIR_NAME.test(e.name))
    .map((e) => ({ number: Number(e.name), dir: join(folder, e.name) }))
    .sort((a, b) => a.number - b.number);

  if (trips.length === 0) {
    return { isMultiTrip: false, trips: [{ number: 1, dir: folder }] };
  }

  const otherDirs = subdirs
    .filter((e) => !TRIP_DIR_NAME.test(e.name))
    .map((e) => e.name);
  if (otherDirs.length > 0) {
    console.warn(
      `[ingest] ${slug}: skipping subfolder(s) not named with a trip number: ${otherDirs.join(", ")}`,
    );
  }
  const looseMedia = entries
    .filter((e) => e.isFile() && isMediaFile(e.name))
    .map((e) => e.name);
  if (looseMedia.length > 0) {
    console.warn(
      `[ingest] ${slug}: skipping ${looseMedia.length} photo(s)/video(s) outside the trip subfolders: ${looseMedia.join(", ")}`,
    );
  }
  return { isMultiTrip: true, trips };
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

/** One trip's by-day block: in a multi-trip folder, its own entry of the
 * nested block, so a filename shared with another trip gets this trip's
 * date, coord and weather. */
function tripBlock(
  photos: PhotosBlock | undefined,
  isMultiTrip: boolean,
  number: number,
): PhotoOverridesByDay | undefined {
  return (isMultiTrip ? photos?.[String(number)] : photos) as
    | PhotoOverridesByDay
    | undefined;
}

async function loadTaggedMedia(
  tripDir: string,
  photoOverrides: PhotosBlock | undefined,
): Promise<TaggedMedia[]> {
  const media = await readTaggedMedia(tripDir, photoOverrides);
  const utcDays = media.map((m) => m.takenAt.toISOString().slice(0, 10));
  localizeExactInstants(media);
  // A file's own recorded date beats the one it's filed under
  // (--photos-template re-files it in trip.json too).
  const misfiled = misfiledMoves(media, utcDays, photoOverrides);
  applyFiledDates(media, photoOverrides, misfiled);
  media.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  return media;
}

/** Each media file's metadata, with hand-typed coords merged in; exact
 * instants are still UTC (see localizeExactInstants). */
async function readTaggedMedia(
  tripDir: string,
  photoOverrides: PhotosBlock | undefined,
): Promise<TaggedMedia[]> {
  const entries = await readdir(tripDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && isMediaFile(e.name));

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
    if (m.lat != null && m.lng != null) m.gps = { lat: m.lat, lng: m.lng };
    const coord = parseCoord(overrideIndex.get(basename(m.sourcePath))?.coord);
    if (coord) {
      m.lat = coord.lat;
      m.lng = coord.lng;
    }
  }
  return media;
}

function localizeExactInstants(media: TaggedMedia[]): void {
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
  // No coordinate: use the UTC offset of the nearest item that recorded one.
  localizeByNearestOffset(media);
}

function applyFiledDates(
  media: TaggedMedia[],
  photoOverrides: PhotosBlock | undefined,
  skip: ReadonlyMap<string, string> = new Map(),
): void {
  // The date a photo is filed under in trip.json is its date: moving an
  // entry to another date there corrects a wrong one. The time of day is
  // kept, so photos on that day still sort among each other. Files in
  // `skip` keep their own date.
  const dates = filedDates(photoOverrides);
  for (const m of media) {
    if (skip.has(basename(m.sourcePath))) continue;
    const day = dates.get(basename(m.sourcePath));
    if (day && day !== m.takenAt.toISOString().slice(0, 10)) {
      m.takenAt = new Date(Date.parse(day) + (m.takenAt.getTime() % DAY_MS));
    }
  }
}

/** One folder can hold several trips (one per numbered subfolder — see
 * listTrips); each becomes its own Trip row. */
async function ingestTrip(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  if (!(await exists(tripDir))) {
    const { count } = await prisma.trip.deleteMany({ where: { slug } });
    if (count > 0) {
      console.log(`[ingest] ${slug}: folder gone, removed from the site`);
    }
    return;
  }
  console.log(`[ingest] ${slug}: scanning...`);

  const overrides = await readTripOverrides(tripDir);
  const { isMultiTrip, trips } = await listTrips(slug);

  const prepared: PreparedTrip[] = [];
  for (const { number, dir } of trips) {
    const media = await loadTaggedMedia(
      dir,
      tripBlock(overrides.photos, isMultiTrip, number),
    );
    if (media.length === 0) {
      console.warn(
        `[ingest] ${tripLabel(slug, number, isMultiTrip)}: no photos found, skipping`,
      );
      continue;
    }
    const trip = await prepareTrip(slug, number, isMultiTrip, media, overrides);
    if (trip) prepared.push(trip);
  }

  // Everything from here is DB-only — wrapped in one transaction so a
  // failure partway through leaves the previous ingest of this folder intact
  // instead of a half-wiped/half-written one.
  await prisma.$transaction(
    async (tx) => {
      // Wipe and recreate this folder's rows — cascades to Step/Media.
      await tx.trip.deleteMany({ where: { slug } });
      for (const trip of prepared) await writeTrip(tx, slug, overrides, trip);
    },
    { timeout: 30_000 },
  ); // default 5s can be too short for a large trip's row count

  for (const trip of prepared) {
    console.log(
      `[ingest] ${trip.label}: done (${trip.distanceKm} km, ${trip.countryCodes.length} countries)`,
    );
  }
}

type PreparedTrip = NonNullable<Awaited<ReturnType<typeof prepareTrip>>>;

/** Everything for one trip that doesn't touch the DB: steps, stats and
 * photo derivatives. Null when no step could be placed (no GPS at all). */
async function prepareTrip(
  slug: string,
  number: number,
  isMultiTrip: boolean,
  media: TaggedMedia[],
  overrides: TripOverrides,
) {
  const label = tripLabel(slug, number, isMultiTrip);
  const draftSteps = groupIntoSteps(media);
  console.log(
    `[ingest] ${label}: ${media.length} photos -> ${draftSteps.length} steps`,
  );
  if (draftSteps.length === 0) {
    console.warn(
      `[ingest] ${label}: no geotagged photos, skipping — fill in coords with --photos-template`,
    );
    return null;
  }

  const overrideIndex = buildOverrideIndex(
    tripBlock(overrides.photos, isMultiTrip, number),
  );
  const tripTitle = overrides.title ?? humanizeSlug(slug);

  const stepInputs = draftSteps.map((step, i) => {
    const prev = draftSteps[i - 1];
    const heaven = isHeaven(step.centroid); // see src/lib/heaven.ts
    const countryCode = heaven
      ? ""
      : (countryCodeForPoint(step.centroid) ?? "");
    // Weather only ever comes from the photo overrides — cached once by
    // `npm run ingest -- --photos-template`, never fetched live here. Temp,
    // code and locationName can each be filled in on different photos within
    // the same step, so each is taken from the first photo that has it.
    const photoOverrides = step.media.map((m) =>
      overrideIndex.get(basename(m.sourcePath)),
    );
    const first = <
      K extends "locationName" | "cityName" | "weatherTempF" | "weatherCode",
    >(
      key: K,
    ) =>
      photoOverrides.map((o) => o?.[key]).find((v) => v != null && v !== "") ??
      null;
    const placeName = heaven
      ? heavenName(tripTitle)
      : first("locationName") || nearestPlaceName(step.centroid, countryCode);

    return {
      order: i,
      title:
        stepTitleOverride(overrides.stepTitles, number, isMultiTrip, i) ??
        placeName,
      locationName: placeName,
      cityName: heaven
        ? HEAVEN_PLACE
        : first("cityName") || cityNameFor(step.centroid, countryCode),
      countryCode,
      lat: step.centroid.lat,
      lng: step.centroid.lng,
      arrivedAt: step.arrivedAt,
      journalText: step.captions.join("\n\n"),
      // Speed is estimated from the gap between the *last* photo of the
      // departure step and the *first* photo of the arrival step — using
      // `arrivedAt` (the departure step's own first photo) instead would
      // count that entire day's local activity before ever leaving as
      // transit time, deflating the implied speed enough to misclassify a
      // real flight as ground transport.
      transportMode: prev
        ? inferTransportMode(
            prev.centroid,
            step.centroid,
            prev.media.at(-1)!.takenAt,
            step.arrivedAt,
          )
        : "FOOT",
      weatherTempF: heaven ? null : first("weatherTempF"),
      weatherCode: heaven ? null : first("weatherCode"),
    };
  });

  // Span of the photos themselves, not of step arrivals — the last step can
  // last several days after you arrive.
  const startDate = media[0]!.takenAt;
  const endDate = media.at(-1)!.takenAt;
  const distanceKm = tripDistanceKm(stepInputs.filter((s) => !isHeaven(s)));
  const countryCodes = uniqueCountryCodes(stepInputs);

  // The expensive part (HEIC conversion + resize, video transcode, or a
  // cache hit's file reads) runs concurrently across every photo/video in
  // the trip, independent of the DB — processImage()/processVideo()
  // themselves skip the work when a file's derivatives are already cached.
  // Flattened across steps (not processed step-by-step) so the concurrency
  // pool stays full even when steps have few files each.
  type MediaJob = { stepIndex: number; mediaIndex: number; m: TaggedMedia };
  const jobs: MediaJob[] = draftSteps.flatMap((step, stepIndex) =>
    step.media.map((m, mediaIndex) => ({ stepIndex, mediaIndex, m })),
  );
  const cacheDir = join(CACHE_DIR, slug);
  const processed = await mapWithConcurrency(jobs, async (job) => {
    try {
      const deriveFn = job.m.kind === "video" ? processVideo : processImage;
      const derivative = await deriveFn(job.m.sourcePath, cacheDir);
      return { job, derivative };
    } catch (err) {
      console.warn(
        `[ingest] ${slug}: failed to process ${job.m.sourcePath}:`,
        err,
      );
      return { job, derivative: undefined };
    }
  });
  await saveSourceIndex(cacheDir);

  // Byte-identical copies (e.g. "IMG_1 (1).jpeg") share a content hash, which
  // keys a trip's media URLs and placeholders — keep the first, drop the rest.
  const seenHashes = new Map<string, string>();
  const unique = processed.filter(({ job, derivative }) => {
    if (!derivative) return true;
    const first = seenHashes.get(derivative.hash);
    if (first) {
      console.warn(
        `[ingest] ${slug}: skipping ${basename(job.m.sourcePath)} (duplicate of ${first})`,
      );
      return false;
    }
    seenHashes.set(derivative.hash, basename(job.m.sourcePath));
    return true;
  });

  return {
    number,
    label,
    startDate,
    endDate,
    distanceKm,
    countryCodes,
    stepInputs,
    processed: unique,
  };
}

async function writeTrip(
  tx: Prisma.TransactionClient,
  slug: string,
  overrides: TripOverrides,
  p: PreparedTrip,
): Promise<void> {
  const trip = await tx.trip.create({
    data: {
      slug,
      number: p.number,
      title: overrides.title ?? humanizeSlug(slug),
      description: overrides.description ?? "",
      startDate: p.startDate,
      endDate: p.endDate,
      distanceKm: p.distanceKm,
      countryCodes: JSON.stringify(p.countryCodes),
    },
  });

  // Batched inserts rather than a round trip per row.
  const createdSteps = await tx.step.createManyAndReturn({
    data: p.stepInputs.map((step) => ({ tripId: trip.id, ...step })),
    select: { id: true, order: true },
  });
  const stepIdByOrder = new Map(createdSteps.map((s) => [s.order, s.id]));
  const stepId = (job: { stepIndex: number }) =>
    stepIdByOrder.get(job.stepIndex)!; // a step's order is its index

  const stored = p.processed.filter((r) => r.derivative);
  await tx.media.createMany({
    data: stored.map(({ job, derivative }) => ({
      stepId: stepId(job),
      type: job.m.kind === "video" ? "VIDEO" : "IMAGE",
      sourcePath: relative(process.cwd(), job.m.sourcePath),
      hash: derivative!.hash,
      width: derivative!.width,
      height: derivative!.height,
      durationSec: derivative!.durationSec ?? null,
      takenAt: job.m.takenAt,
      lat: job.m.lat ?? null,
      lng: job.m.lng ?? null,
      placeholder: derivative!.placeholder,
      order: job.mediaIndex,
    })),
  });

  // trip.json "cover": a filename in the trip folder, e.g. "IMG_0042.HEIC".
  // In a multi-trip folder it only matches inside the trip holding that file.
  const cover = stored.find(
    ({ job }) => basename(job.m.sourcePath) === overrides.cover,
  );
  if (cover) {
    const media = await tx.media.findFirst({
      where: { stepId: stepId(cover.job), order: cover.job.mediaIndex },
      select: { id: true },
    });
    await tx.trip.update({
      where: { id: trip.id },
      data: { coverMediaId: media?.id },
    });
  }
}

const takenAtByFile = (media: TaggedMedia[]) =>
  new Map(media.map((m) => [basename(m.sourcePath), m.takenAt]));

/**
 * Fetches weather for any entry that has a `coord` but is still missing
 * `weatherTempF`/`weatherCode` — done here (network I/O) rather than in
 * `buildPhotoTemplate` (kept pure/offline) — so it's persisted to trip.json
 * once instead of being re-fetched on every regular ingest. With `replace`,
 * refetches every entry instead, keeping the old value where a fetch fails.
 * Returns how many entries' fetches failed.
 */
async function fillWeatherOverrides(
  photos: PhotosBlock,
  media: TaggedMedia[],
  replace = false,
): Promise<number> {
  const takenAtOf = takenAtByFile(media);

  const needsWeather = allEntries(photos).filter(
    (entry) =>
      replace || entry.weatherTempF == null || entry.weatherCode == null,
  );

  // A day's photos are mostly at one spot: one request per place and day.
  const fetches = new Map<string, ReturnType<typeof fetchHistoricalWeather>>();
  let failed = 0;

  await mapWithConcurrency(
    needsWeather,
    async (entry) => {
      const coord = parseCoord(entry.coord);
      const takenAt = takenAtOf.get(entry.file);
      if (!coord || !takenAt || isHeaven(coord)) return;

      const key = `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)},${takenAt.toISOString().slice(0, 10)}`;
      let fetching = fetches.get(key);
      if (!fetching) {
        fetching = fetchHistoricalWeather(coord.lat, coord.lng, takenAt);
        fetches.set(key, fetching);
      }
      const weather = await fetching;
      if (!weather) {
        failed++;
      } else if (replace) {
        entry.weatherTempF = weather.tempF;
        entry.weatherCode = weather.code;
      } else {
        entry.weatherTempF ??= weather.tempF;
        entry.weatherCode ??= weather.code;
      }
    },
    4, // one per core got some requests refused on a big trip
  );
  return failed;
}

async function refreshWeather(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  const tripJsonPath = join(tripDir, "trip.json");
  const overrides = await readTripOverrides(tripDir);
  if (!overrides.photos) {
    console.warn(`[ingest] ${slug}: no "photos" in trip.json, nothing to do`);
    return;
  }
  const { isMultiTrip, trips } = await listTrips(slug);
  const blocks = trips.map((t) =>
    tripBlock(overrides.photos, isMultiTrip, t.number),
  );
  const mediaByTrip = await Promise.all(
    trips.map((t, i) => loadTaggedMedia(t.dir, blocks[i])),
  );

  const stamp = new Date().toISOString().replace(/[-:]|\..*/g, "");
  const backupPath = `${tripJsonPath}.${stamp}.bak`;
  await copyFile(tripJsonPath, backupPath);

  let failed = 0;
  for (const [i, block] of blocks.entries()) {
    if (block)
      failed += await fillWeatherOverrides(block, mediaByTrip[i]!, true);
  }
  await writeFile(tripJsonPath, JSON.stringify(overrides, null, 2) + "\n");
  console.log(
    `[ingest] ${slug}: weather refreshed, ${failed} photo(s) kept their old weather (fetch failed); backup at ${backupPath}`,
  );
}

// Each photo's coord as of the last template run, so a changed coord's place
// name and weather get re-derived (and nothing else is touched). Kept in the
// cache, not trip.json, which stays exactly as hand-edited.
const templateCoordsPath = (slug: string) =>
  join(CACHE_DIR, slug, "template-coords.json");

async function readTemplateCoords(
  slug: string,
): Promise<Record<string, string>> {
  return readFile(templateCoordsPath(slug), "utf8")
    .then((raw) => JSON.parse(raw) as Record<string, string>)
    .catch(() => ({}));
}

async function writeTemplateCoords(
  slug: string,
  coords: Record<string, string>,
): Promise<void> {
  await mkdir(join(CACHE_DIR, slug), { recursive: true });
  await writeFile(templateCoordsPath(slug), JSON.stringify(coords));
}

async function writePhotoTemplate(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  const tripJsonPath = join(tripDir, "trip.json");

  const overrides = await readTripOverrides(tripDir);
  const { isMultiTrip, trips } = await listTrips(slug);
  // loadTaggedMedia's steps, with misfiled entries re-filed (see
  // misfiledMoves) before the filed dates are applied.
  const mediaByTrip: { number: number; media: TaggedMedia[] }[] = [];
  const read = await Promise.all(
    trips.map((t) =>
      readTaggedMedia(
        t.dir,
        tripBlock(overrides.photos, isMultiTrip, t.number),
      ),
    ),
  );
  for (const [i, t] of trips.entries()) {
    const media = read[i]!;
    const utcDays = media.map((m) => m.takenAt.toISOString().slice(0, 10));
    localizeExactInstants(media);
    const own = tripBlock(overrides.photos, isMultiTrip, t.number);
    const moves = own
      ? misfiledMoves(media, utcDays, own)
      : new Map<string, string>();
    const was = filedDates(own);
    if (own) {
      moveEntries(own, moves);
      // Its weather was the old date's. Blank, it's fetched below or, with
      // weather off or a failed fetch, on a later run.
      for (const e of allEntries(own)) {
        if (!moves.has(e.file)) continue;
        e.weatherTempF = null;
        e.weatherCode = null;
      }
    }
    for (const [file, day] of moves) {
      console.log(
        `[ingest] ${tripLabel(slug, t.number, isMultiTrip)} ${file}: moved ${was.get(file)} -> ${day} (its recorded date)`,
      );
    }
    applyFiledDates(media, own);
    // A moved entry's hand-typed coord was for its old date: take the
    // nearest unmoved item's (names and weather refresh below, as the coord
    // changed). The file's own GPS, or a blank coord over it, stays.
    for (const e of own ? allEntries(own) : []) {
      if (!moves.has(e.file)) continue;
      const m = media.find((m) => basename(m.sourcePath) === e.file)!;
      if (m.gps && (!e.coord || isSameCoord(parseCoord(e.coord), m.gps))) {
        continue;
      }
      e.coord = nearestCoord(media, m, moves) ?? e.coord;
    }
    media.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    mediaByTrip.push({ number: t.number, media });
  }
  const media = mediaByTrip.flatMap((t) => t.media);

  if (media.length === 0) {
    console.warn(`[ingest] ${slug}: no photos found, nothing to template`);
    return;
  }

  // A folder with trip subfolders gets its photos nested by trip number
  // first ({ "1": { "2025-05-16": [...] }, "3": ... }); a single trip keeps
  // the flat by-day layout. Entries are matched by filename either way, so
  // anything already filled in carries over when photos change trip.
  // Each date's entries in time order, as the site shows them.
  const sortedTemplate = (tripMedia: TaggedMedia[], number: number) => {
    const byDay = buildPhotoTemplate(
      tripMedia,
      overrides.photos,
      tripBlock(overrides.photos, isMultiTrip, number),
    );
    sortEntriesByTime(byDay, takenAtByFile(tripMedia));
    return byDay;
  };
  const photos: PhotosBlock = isMultiTrip
    ? Object.fromEntries(
        mediaByTrip.map((t) => [
          String(t.number),
          sortedTemplate(t.media, t.number),
        ]),
      )
    : sortedTemplate(media, mediaByTrip[0]!.number);

  // A coordless photo takes the coord of the nearest-in-time photo on its
  // date that has one (names and weather fill in below). Copy-date (mtime)
  // photos have no real time, so they're left for a hand-typed coord; a
  // blank coord over the file's own GPS stays, as for moved entries above.
  for (const t of mediaByTrip) {
    for (const e of allEntries(tripBlock(photos, isMultiTrip, t.number))) {
      if (e.coord != null) continue;
      const m = t.media.find((m) => basename(m.sourcePath) === e.file);
      if (!m || m.takenAtIsMtime || m.gps) continue;
      const coord = nearestCoord(t.media, m, new Map(), true);
      if (!coord) continue;
      e.coord = coord;
      console.log(
        `[ingest] ${tripLabel(slug, t.number, isMultiTrip)} ${e.file}: no coord, took nearest same-day photo's (${coord})`,
      );
    }
  }

  const lastCoords = await readTemplateCoords(slug);
  const refreshed = refreshChangedCoords(photos, lastCoords, WEATHER_ENABLED);
  if (refreshed.length > 0) {
    console.log(
      `[ingest] ${slug}: coord changed, refreshing place/weather for ${refreshed.join(", ")}`,
    );
  }
  if (WEATHER_ENABLED) {
    for (const t of mediaByTrip) {
      await fillWeatherOverrides(
        tripBlock(photos, isMultiTrip, t.number) ?? {},
        t.media,
      );
    }
  }
  // Only a missing `coord` needs a human — locationName/weather are always
  // derivable once a coord (real or hand-typed) exists.
  const needingInfo = allEntries(photos).filter((e) => e.coord == null).length;

  const updated: TripOverrides = { ...overrides, photos };
  const json = JSON.stringify(updated, null, 2) + "\n";
  const current = await readFile(tripJsonPath, "utf8").catch(() => null);
  if (current != null && current !== json) {
    const stamp = new Date().toISOString().replace(/[-:]|\..*/g, "");
    const backupPath = `${tripJsonPath}.${stamp}.bak`;
    await copyFile(tripJsonPath, backupPath);
    console.log(`[ingest] ${slug}: trip.json changed; backup at ${backupPath}`);
  }
  await writeFile(tripJsonPath, json);

  // With weather off, a refreshed photo's weather is still the old coord's —
  // leave it looking changed so a later run with weather on refetches it.
  const pending = new Set(WEATHER_ENABLED ? [] : refreshed);
  const coords = Object.fromEntries(
    allEntries(photos)
      .filter((e) => e.coord)
      .map((e) => [
        e.file,
        pending.has(e.file) ? (lastCoords[e.file] ?? "") : e.coord!,
      ]),
  );
  await writeTemplateCoords(slug, coords);

  const days = dayGroups(photos).reduce(
    (n, byDay) => n + Object.keys(byDay).length,
    0,
  );
  console.log(
    `[ingest] ${slug}: ${needingInfo} photo(s) still need a coord, across ${days} day(s) — fill in "photos" in ${tripJsonPath}`,
  );
}

/**
 * What the trip page's "change location" picker saves (via
 * /api/step-location): moves every photo in one step to `coord`. Only that
 * step is looked at — its photos' trip.json entries get the new coord, place
 * name and weather (the same values a --photos-template run would derive),
 * and its DB rows are patched in place, without re-reading or re-geocoding
 * the rest of the trip. If the move changes how photos group into steps
 * (e.g. the new spot merges it into the same day's previous step), the whole
 * trip is re-ingested instead, so the result always matches a full ingest.
 */
async function moveStep(stepId: string, coord: string): Promise<void> {
  const point = parseCoord(coord);
  if (!point || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
    throw new Error(`invalid coord "${coord}"`);
  }
  const target = await prisma.step.findUnique({
    where: { id: stepId },
    select: { tripId: true },
  });
  if (!target) throw new Error(`no step ${stepId}`);
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: target.tripId },
    select: {
      id: true,
      slug: true,
      number: true,
      title: true,
      steps: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          lat: true,
          lng: true,
          countryCode: true,
          media: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              sourcePath: true,
              type: true,
              takenAt: true,
              lat: true,
              lng: true,
            },
          },
        },
      },
    },
  });
  const { slug } = trip;
  const k = trip.steps.findIndex((st) => st.id === stepId);
  const moved = trip.steps[k]!.media;
  const files = moved.map((m) => basename(m.sourcePath));

  // trip.json: the step's entries only. A photo with no entry yet needs a
  // template run first, so it's filed under the right date.
  const tripDir = join(ASSETS_DIR, slug);
  const { isMultiTrip } = await listTrips(slug);
  const ownIndex = (photos: PhotosBlock | undefined) =>
    buildOverrideIndex(tripBlock(photos, isMultiTrip, trip.number));
  let overrides = await readTripOverrides(tripDir);
  if (files.some((f) => !ownIndex(overrides.photos).has(f))) {
    await writePhotoTemplate(slug);
    overrides = await readTripOverrides(tripDir);
  }
  const index = ownIndex(overrides.photos);
  const entries = files.flatMap((f) => index.get(f) ?? []);
  const names = namesFor(point);
  for (const entry of entries) {
    entry.coord = coord;
    Object.assign(entry, names);
    entry.weatherTempF = null;
    entry.weatherCode = null;
  }
  // Same media shape the template works from; DB values are already final
  // (filed dates and timezone applied at ingest).
  const allMedia: TaggedMedia[] = trip.steps.flatMap((st, i) =>
    st.media.map((m) => ({
      sourcePath: m.sourcePath,
      kind: m.type === "VIDEO" ? ("video" as const) : ("photo" as const),
      takenAt: m.takenAt,
      lat: i === k ? point.lat : (m.lat ?? undefined),
      lng: i === k ? point.lng : (m.lng ?? undefined),
    })),
  );
  if (WEATHER_ENABLED) {
    await fillWeatherOverrides({ moved: entries }, allMedia);
  }
  await writeFile(
    join(tripDir, "trip.json"),
    JSON.stringify(overrides, null, 2) + "\n",
  );
  // Keep the template's coord record in step, as a template run would.
  const lastCoords = await readTemplateCoords(slug);
  for (const f of files) {
    lastCoords[f] = WEATHER_ENABLED ? coord : (lastCoords[f] ?? "");
  }
  await writeTemplateCoords(slug, lastCoords);
  console.log(`[ingest] ${slug}: moved ${files.length} photo(s) to ${coord}`);

  allMedia.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const drafts = groupIntoSteps(allMedia);
  const sameGrouping =
    drafts.length === trip.steps.length &&
    drafts.every((d, i) => {
      const ids = new Set(trip.steps[i]!.media.map((m) => m.sourcePath));
      return (
        d.media.length === ids.size &&
        d.media.every((m) => ids.has(m.sourcePath))
      );
    });
  if (!sameGrouping) {
    console.log(`[ingest] ${slug}: steps regroup, re-ingesting the trip`);
    await ingestTrip(slug);
    return;
  }

  const step = drafts[k]!;
  const first = <K extends "weatherTempF" | "weatherCode">(key: K) =>
    step.media
      .map((m) => index.get(basename(m.sourcePath))?.[key])
      .find((v) => v != null) ?? null;
  const transportMode = (i: number) =>
    inferTransportMode(
      drafts[i - 1]!.centroid,
      drafts[i]!.centroid,
      drafts[i - 1]!.media.at(-1)!.takenAt,
      drafts[i]!.arrivedAt,
    );
  const heaven = isHeaven(point);
  const countryCode = heaven ? "" : (countryCodeForPoint(point) ?? "");
  const locationName = heaven ? heavenName(trip.title) : names.locationName;
  const steps = trip.steps.map((st, i) =>
    i === k ? { ...st, ...point, countryCode } : st,
  );
  const next = trip.steps[k + 1];

  await prisma.$transaction([
    prisma.step.update({
      where: { id: stepId },
      data: {
        ...point,
        countryCode,
        locationName,
        cityName: names.cityName,
        title:
          stepTitleOverride(
            overrides.stepTitles,
            trip.number,
            isMultiTrip,
            k,
          ) ?? locationName,
        arrivedAt: step.arrivedAt,
        weatherTempF: heaven ? null : first("weatherTempF"),
        weatherCode: heaven ? null : first("weatherCode"),
        ...(k > 0 && { transportMode: transportMode(k) }),
      },
    }),
    ...(next
      ? [
          prisma.step.update({
            where: { id: next.id },
            data: { transportMode: transportMode(k + 1) },
          }),
        ]
      : []),
    prisma.media.updateMany({
      where: { stepId },
      data: point,
    }),
    prisma.trip.update({
      where: { id: trip.id },
      data: {
        distanceKm: tripDistanceKm(steps.filter((st) => !isHeaven(st))),
        countryCodes: JSON.stringify(uniqueCountryCodes(steps)),
      },
    }),
  ]);
}

async function ingestAll(onlySlug?: string): Promise<void> {
  const slugs = onlySlug ? [onlySlug] : await listTripSlugs();
  // Trips whose folder is gone (ingestTrip drops them) — unless assets/
  // looks empty, e.g. an unmounted drive, which would wipe every trip.
  if (!onlySlug && slugs.length > 0) {
    const inDb = await prisma.trip.findMany({
      select: { slug: true },
      distinct: ["slug"],
    });
    for (const { slug } of inDb) if (!slugs.includes(slug)) slugs.push(slug);
  }
  for (const slug of slugs) {
    try {
      await ingestTrip(slug);
    } catch (err) {
      console.error(`[ingest] ${slug}: failed`, err);
    }
  }
}

/** Prints each trip's exact and near-duplicate photos (videos skipped).
 * Report only: the files, trip.json and the DB are left as they are. */
async function findDuplicates(slug: string): Promise<void> {
  const overrides = await readTripOverrides(join(ASSETS_DIR, slug));
  const { isMultiTrip, trips } = await listTrips(slug);
  const cacheDir = join(CACHE_DIR, slug);
  for (const { number, dir } of trips) {
    const label = tripLabel(slug, number, isMultiTrip);
    const photos = (
      await loadTaggedMedia(
        dir,
        tripBlock(overrides.photos, isMultiTrip, number),
      )
    ).filter((m) => m.kind === "photo");
    // Hashed from the cached 400px thumbnail (made now if missing), which
    // also spares decoding every HEIC original again.
    const hashed = await mapWithConcurrency(photos, async (m) => {
      try {
        const { hash } = await processImage(m.sourcePath, cacheDir);
        const thumb = await readFile(join(cacheDir, `${hash}-thumb.jpg`));
        return {
          file: basename(m.sourcePath),
          contentHash: hash,
          perceptualHash: await perceptualHash(thumb),
        };
      } catch (err) {
        console.warn(`[duplicates] ${label}: can't read ${m.sourcePath}:`, err);
        return null;
      }
    });
    await saveSourceIndex(cacheDir);
    const groups = findDuplicateGroups(hashed.filter((h) => h !== null));
    console.log(
      `[duplicates] ${label}: ${photos.length} photos, ${groups.length} duplicate group(s)`,
    );
    for (const g of groups) {
      const how =
        g.kind === "exact" ? "exact" : `near, distance ${g.maxDistance}`;
      console.log(`  ${how}: ${g.files.join(", ")}`);
    }
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Renames a trip folder and its cache folder (so media derivatives and
 * template-coords.json carry over), drops the old name's DB rows and
 * ingests the new one. Files inside the folder aren't touched. */
async function renameTrip(from: string, to: string): Promise<void> {
  if (!SAFE_SLUG.test(to)) {
    throw new Error(`"${to}": use only letters, digits, - and _`);
  }
  const fromDir = join(ASSETS_DIR, from);
  const toDir = join(ASSETS_DIR, to);
  if (!(await stat(fromDir).catch(() => null))?.isDirectory()) {
    throw new Error(`${fromDir} is not a folder`);
  }
  for (const path of [toDir, join(CACHE_DIR, to)]) {
    if (await exists(path)) throw new Error(`${path} already exists`);
  }
  // Cache first: a running --watch ingests the new folder ~2 s after it
  // appears, and would otherwise re-encode everything into a fresh cache.
  const fromCache = join(CACHE_DIR, from);
  const movedCache = await exists(fromCache);
  if (movedCache) await rename(fromCache, join(CACHE_DIR, to));
  try {
    await rename(fromDir, toDir);
  } catch (err) {
    if (movedCache) await rename(join(CACHE_DIR, to), fromCache);
    throw err;
  }
  console.log(`[ingest] renamed ${from} -> ${to}`);
  // sources.json is keyed by source path; re-key it so files aren't re-hashed.
  const sourcesPath = join(CACHE_DIR, to, "sources.json");
  const sources = await readFile(sourcesPath, "utf8").then(
    (raw) => JSON.parse(raw) as Record<string, string>,
    () => null,
  );
  if (sources) {
    const prefix = `${fromDir}/`;
    const rekeyed = Object.entries(sources).map(([key, hash]) => [
      key.startsWith(prefix) ? `${toDir}/${key.slice(prefix.length)}` : key,
      hash,
    ]);
    await writeFile(sourcesPath, JSON.stringify(Object.fromEntries(rekeyed)));
  }
  await prisma.trip.deleteMany({ where: { slug: from } });
  await ingestTrip(to);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const renameIndex = args.indexOf("--rename");
  if (renameIndex !== -1) {
    const [from, to] = args.slice(renameIndex + 1);
    if (!from || !to) throw new Error("usage: --rename <old-slug> <new-slug>");
    await renameTrip(from, to);
    await refreshSite();
    await prisma.$disconnect();
    return;
  }

  // Run by the site's /api/step-location route, not by hand.
  const moveIndex = args.indexOf("--move-step");
  if (moveIndex !== -1) {
    const [stepId, coord] = args.slice(moveIndex + 1);
    if (!stepId || !coord) {
      throw new Error("usage: --move-step <stepId> <lat,lng>");
    }
    await moveStep(stepId, coord);
    await refreshSite();
    await prisma.$disconnect();
    return;
  }

  const templateFlagIndex = args.indexOf("--photos-template");
  if (templateFlagIndex !== -1) {
    const slug = args[templateFlagIndex + 1];
    const slugs = slug ? [slug] : await listTripSlugs();
    for (const s of slugs) {
      await writePhotoTemplate(s);
      await ingestTrip(s);
    }
    await refreshSite();
    await prisma.$disconnect();
    return;
  }

  const duplicatesFlagIndex = args.indexOf("--find-duplicates");
  if (duplicatesFlagIndex !== -1) {
    const slug = args[duplicatesFlagIndex + 1];
    const slugs = slug ? [slug] : await listTripSlugs();
    for (const s of slugs) await findDuplicates(s);
    await prisma.$disconnect();
    return;
  }

  const weatherFlagIndex = args.indexOf("--refresh-weather");
  if (weatherFlagIndex !== -1) {
    const slug = args[weatherFlagIndex + 1];
    const slugs = slug ? [slug] : await listTripSlugs();
    for (const s of slugs) {
      await refreshWeather(s);
      await ingestTrip(s);
    }
    await refreshSite();
    await prisma.$disconnect();
    return;
  }

  const rebuild = args.includes("--rebuild");
  const watch = args.includes("--watch");
  const onlySlug = args.find((a) => !a.startsWith("--"));

  if (rebuild) {
    console.log("[ingest] --rebuild: wiping database");
    await prisma.trip.deleteMany(); // cascades to Step/Media
  }

  await ingestAll(onlySlug);
  await refreshSite();

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
          ingestTrip(slug)
            .then(refreshSite)
            .catch((err) => console.error(`[ingest] ${slug}: failed`, err));
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
