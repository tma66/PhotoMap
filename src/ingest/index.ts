// Ingestion entry point: turns assets/<slug>/*.{jpg,heic,...} into rows in
// the SQLite cache (prisma/schema.prisma) plus resized/EXIF-stripped photos
// in data/cache/. Safe to re-run any time — each trip is fully rebuilt from
// its source folder, so the DB is always a pure derivative of assets/. The
// DB step itself never touches the network: weather comes only from what's
// cached in trip.json's "photos" block (filled in by the steps below). One
// folder can hold several trips, one per numbered subfolder (assets/EDC/1/,
// assets/EDC/3/ — the name is the trip's number and URL); a folder with just
// photos in it is a single trip #1. See listTrips below.
//
// Usage (package.json scripts; npm drops a flag not after `--`, so each
// flag has its own script):
//   npm run ingest [my-trip] -- update every trip, or just one. For each:
//     1. Files are renamed: an image's extension matched to its content, and
//        a local "20221225-153803_" time prefix (see file-names.ts).
//     2. trip.json's "photos" block is (re)written: one entry per photo,
//        grouped by its own local calendar date (see src/ingest/timezone.ts).
//        Real EXIF GPS photos get coord/locationName/weather auto-filled; a
//        GPS-less photo with no coord takes the nearest-in-time coord on its
//        date (a copy-date photo only once given the nearest IMG_####'s time
//        on its filed date — see estimateUndatedTimes; none on a day with no
//        coords), else
//        needs one typed in, after which locationName/weather auto-fill too
//        (this and the site's --move-step are the only steps that fetch
//        weather — see src/ingest/photo-overrides.ts). An entry filed under
//        a date other than its file's recorded one (up to 7 days off; see
//        misfiledMoves) moves to it, a hand-typed coord becoming the nearest
//        unmoved item's (within 6 h), weather refetched; copy-date (mtime)
//        files, and entries further off, stay where they're filed — except
//        a copy-date file still on its copy date, filed by its nearest
//        IMG_#### neighbours' date (see undatedDays; the rest, and any
//        whose number range two cameras share, are printed with their
//        neighbours, to move by hand). Each
//        date's entries are sorted by time, and trip.json.<timestamp>.bak is
//        kept when the file changes. Duplicate images are printed
//        (see reportDuplicates); all copies stay on the site, bar
//        byte-identical ones (shown once).
//     3. The trip is ingested into the DB.
//     With no slug, trips whose folder is gone are dropped too. Then the
//     cache is pruned: stale source hashes, derivatives of files since
//     deleted or edited, and a gone trip's whole cache folder (pruneCaches).
//   npm run watch   -- ingest only (no renames, no trip.json
//     writes), then keep watching assets/ and re-ingest a changed trip
//   npm run rebuild -- wipe the whole DB, then ingest only
//   npm run rename old-slug new-slug -- rename a trip folder (its
//     URL) and its cache folder, drop the old name's DB rows and ingest the
//     new one; nothing is re-encoded. NFC tags with the old URL need rewriting.

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
  rm,
  stat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, join, extname, relative, sep } from "node:path";
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
  estimateUndatedTimes,
  undatedDays,
  misfiledMoves,
  type PhotoOverridesByDay,
  type PhotosBlock,
} from "./photo-overrides";
import {
  processImage,
  processVideo,
  pruneDerivatives,
  pruneSourceIndex,
  readHead,
  renameSources,
  saveSourceIndex,
} from "./media";
import { findDuplicateGroups, perceptualHash } from "./duplicates";
import { freeName, normalizedName, sniffImageType } from "./file-names";
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
  /** Shown to public visitors (the Funnel link) — every trip in the folder. */
  public?: boolean;
  /** Keyed by step index — or, in a folder holding several trips, by trip
   * number first: { "2": { "0": "Kyoto" } }. */
  stepTitles?: Record<string, string | Record<string, string>>;
  /** Per-photo manual overrides for missing GPS/location/weather — see
   * src/ingest/photo-overrides.ts. Generate/update with
   * `npm run ingest`. */
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
  // (a plain ingest re-files it in trip.json too).
  const misfiled = misfiledMoves(media, utcDays, photoOverrides);
  applyFiledDates(media, photoOverrides, misfiled);
  estimateUndatedTimes(media);
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
  for (const file of skip.keys()) dates.delete(file);
  setDays(media, dates);
}

/** Moves each item in `days` (file -> date) to that date, keeping its time
 * of day. */
function setDays(media: TaggedMedia[], days: ReadonlyMap<string, string>) {
  for (const m of media) {
    const day = days.get(basename(m.sourcePath));
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
    const own = tripBlock(overrides.photos, isMultiTrip, number);
    const media = await loadTaggedMedia(dir, own);
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
      `[ingest] ${label}: no geotagged photos, skipping — type a coord into trip.json and re-run`,
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
    // updateTrips into trip.json, never fetched live here. Temp,
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
      isPublic: overrides.public === true,
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

  // The trip's card image: the first photo whose trip.json "photos" entry has
  // "cover": true. Only this trip's photos are in `stored`, so each trip of a
  // multi-trip folder gets its own.
  const flagged = new Set(
    allEntries(overrides.photos)
      .filter((e) => e.cover === true)
      .map((e) => e.file),
  );
  const covers = stored.filter(({ job }) =>
    flagged.has(basename(job.m.sourcePath)),
  );
  if (covers.length > 1) {
    console.warn(
      `[ingest] ${slug}: ${covers.length} photos have "cover": true — using ${basename(covers[0]!.job.m.sourcePath)}`,
    );
  }
  const cover = covers[0];
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
 * once instead of being re-fetched on every ingest. Returns how many
 * entries' fetches failed.
 */
async function fillWeatherOverrides(
  photos: PhotosBlock,
  media: TaggedMedia[],
): Promise<number> {
  const takenAtOf = takenAtByFile(media);

  const needsWeather = allEntries(photos).filter(
    (entry) => entry.weatherTempF == null || entry.weatherCode == null,
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
      } else {
        entry.weatherTempF ??= weather.tempF;
        entry.weatherCode ??= weather.code;
      }
    },
    4, // one per core got some requests refused on a big trip
  );
  return failed;
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

const backups = new Map<string, string>();

/** Copies `path` to `<path>.<UTC timestamp>.bak`; returns the copy's path.
 * Once per run: a later call (e.g. the template after the renames) keeps
 * the first copy, the file as it was before this run — a second copy could
 * get the same timestamp and overwrite it. */
async function backUp(path: string): Promise<string> {
  const done = backups.get(path);
  if (done) return done;
  const stamp = new Date().toISOString().replace(/[-:]|\..*/g, "");
  const backupPath = `${path}.${stamp}.bak`;
  await copyFile(path, backupPath);
  backups.set(path, backupPath);
  return backupPath;
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
    const ownDays = media.map((m) => m.takenAt.toISOString().slice(0, 10));
    const own = tripBlock(overrides.photos, isMultiTrip, t.number);
    const moves = own
      ? misfiledMoves(media, utcDays, own)
      : new Map<string, string>();
    const was = filedDates(own);
    // A moved entry's weather was the old date's. Blank, it's fetched below
    // or, with weather off or a failed fetch, on a later run.
    const refile = (to: Map<string, string>) => {
      if (!own) return;
      moveEntries(own, to);
      for (const e of allEntries(own)) {
        if (!to.has(e.file)) continue;
        e.weatherTempF = null;
        e.weatherCode = null;
      }
    };
    refile(moves);
    for (const [file, day] of moves) {
      console.log(
        `[ingest] ${tripLabel(slug, t.number, isMultiTrip)} ${file}: moved ${was.get(file)} -> ${day} (its recorded date)`,
      );
    }
    applyFiledDates(media, own);
    // A copy-date file still on its copy date (never moved, by hand or here)
    // is filed by IMG_#### — see undatedDays.
    const filed = filedDates(own);
    const { moves: undatedMoves, unsure } = undatedDays(
      media,
      new Set(
        media.filter(
          (m, i) =>
            m.takenAtIsMtime &&
            (filed.get(basename(m.sourcePath)) ?? ownDays[i]) === ownDays[i],
        ),
      ),
    );
    refile(undatedMoves);
    setDays(media, undatedMoves);
    for (const [file, day] of undatedMoves) {
      console.log(
        `[ingest] ${tripLabel(slug, t.number, isMultiTrip)} ${file}: no date, filed under ${day} (nearest IMG number)`,
      );
    }
    for (const [file, { near, cameras }] of unsure) {
      console.log(
        `[ingest] ${tripLabel(slug, t.number, isMultiTrip)} ${file}: no date, move it by hand — near ${near.map((x) => `IMG_${String(x.n).padStart(4, "0")} (${x.day})`).join(" and ")}${cameras ? `; cameras sharing these numbers: ${cameras.join(", ")}` : ""}`,
      );
    }
    estimateUndatedTimes(media);
    // A moved entry's hand-typed coord was for its old date: take the
    // nearest unmoved item's (names and weather refresh below, as the coord
    // changed). The file's own GPS, or a blank coord over it, stays.
    // Reversed so a repeated name maps to its first item, as find() did.
    const byFile = new Map(
      [...media].reverse().map((m) => [basename(m.sourcePath), m]),
    );
    for (const e of own ? allEntries(own) : []) {
      if (!moves.has(e.file)) continue;
      const m = byFile.get(e.file)!;
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
    sortEntriesByTime(
      byDay,
      takenAtByFile(
        tripMedia.filter((m) => !m.takenAtIsMtime || m.takenAtIsEstimated),
      ),
    );
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
  // photos have no real time, so unless estimateUndatedTimes placed one
  // they're left for a hand-typed coord; a blank coord over the file's own
  // GPS stays, as for moved entries above.
  for (const t of mediaByTrip) {
    const byFile = new Map(
      [...t.media].reverse().map((m) => [basename(m.sourcePath), m]),
    );
    for (const e of allEntries(tripBlock(photos, isMultiTrip, t.number))) {
      if (e.coord != null) continue;
      const m = byFile.get(e.file);
      if (!m || (m.takenAtIsMtime && !m.takenAtIsEstimated) || m.gps) continue;
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
  for (const t of mediaByTrip) {
    await reportDuplicates(
      tripLabel(slug, t.number, isMultiTrip),
      t.media,
      join(CACHE_DIR, slug),
    );
  }

  // Only a missing `coord` needs a human — locationName/weather are always
  // derivable once a coord (real or hand-typed) exists.
  const needingInfo = allEntries(photos).filter((e) => e.coord == null).length;

  const updated: TripOverrides = { ...overrides, photos };
  const json = JSON.stringify(updated, null, 2) + "\n";
  const current = await readFile(tripJsonPath, "utf8").catch(() => null);
  if (current != null && current !== json) {
    const backupPath = await backUp(tripJsonPath);
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
 * name and weather (the same values a plain ingest would derive),
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

/** Every trip folder plus, with no `onlySlug`, the trips whose folder is
 * gone (ingestTrip drops them) — unless assets/ looks empty, e.g. an
 * unmounted drive, which would wipe every trip. */
async function slugsToIngest(onlySlug?: string): Promise<string[]> {
  const slugs = onlySlug ? [onlySlug] : await listTripSlugs();
  if (!onlySlug && slugs.length > 0) {
    const inDb = await prisma.trip.findMany({
      select: { slug: true },
      distinct: ["slug"],
    });
    for (const { slug } of inDb) if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** For each cache folder (all of them with no `onlySlug`): a trip whose
 * assets/ folder is gone loses its whole cache folder; otherwise hashes of
 * files since renamed, edited or deleted leave sources.json and their
 * derivatives are deleted. Not run by --watch. An empty assets/ (e.g. an
 * unmounted drive) deletes nothing, as in slugsToIngest. A cache folder
 * whose sources.json doesn't point into this ASSETS_DIR is never removed: a
 * scratch ASSETS_DIR against the real cache would read every trip as gone. */
async function pruneCaches(onlySlug?: string): Promise<void> {
  const tripSlugs = await listTripSlugs();
  if (tripSlugs.length === 0) return;
  const names = onlySlug
    ? [onlySlug]
    : (await readdir(CACHE_DIR, { withFileTypes: true }).catch(() => []))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
  const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
  for (const name of names) {
    const cacheDir = join(CACHE_DIR, name);
    if (!tripSlugs.includes(name)) {
      const files = await readdir(cacheDir).catch(() => null);
      if (!files) continue; // no cache either, e.g. a mistyped slug
      const sources = await readFile(join(cacheDir, "sources.json"), "utf8")
        .then((raw) => Object.keys(JSON.parse(raw) as object))
        .catch(() => []);
      const tripDir = join(ASSETS_DIR, name) + sep;
      if (!sources.some((key) => key.startsWith(tripDir))) {
        console.warn(
          `[ingest] ${name}: no assets folder, but its cache isn't from ${ASSETS_DIR} — left in place`,
        );
        continue;
      }
      let bytes = 0;
      for (const f of files) bytes += (await stat(join(cacheDir, f))).size;
      await rm(cacheDir, { recursive: true, force: true });
      console.log(
        `[ingest] ${name}: folder gone, removed its cache (${files.length} files, ${mb(bytes)} MB)`,
      );
      continue;
    }
    const pruned = await pruneSourceIndex(cacheDir);
    if (pruned > 0) {
      console.log(`[ingest] ${name}: dropped ${pruned} stale source hash(es)`);
    }
    const { files, bytes } = await pruneDerivatives(cacheDir);
    if (files > 0) {
      console.log(
        `[ingest] ${name}: removed ${files} unused cache file(s) (${mb(bytes)} MB)`,
      );
    }
  }
}

/** A plain `npm run ingest`: for each trip, renames its files
 * (normalizeFileNames), refreshes trip.json's photos block
 * (writePhotoTemplate) and ingests it; a trip whose folder is gone is
 * dropped. */
async function updateTrips(onlySlug?: string): Promise<void> {
  for (const slug of await slugsToIngest(onlySlug)) {
    try {
      if (await exists(join(ASSETS_DIR, slug))) {
        await normalizeFileNames(slug);
        await writePhotoTemplate(slug);
      }
      await ingestTrip(slug);
    } catch (err) {
      console.error(`[ingest] ${slug}: failed`, err);
    }
  }
}

/** Ingest only — what --rebuild and --watch do. */
async function ingestAll(onlySlug?: string): Promise<void> {
  for (const slug of await slugsToIngest(onlySlug)) {
    try {
      await ingestTrip(slug);
    } catch (err) {
      console.error(`[ingest] ${slug}: failed`, err);
    }
  }
}

/** Each photo's content and perceptual hashes, plus its size for picking
 * which copy of a duplicate to keep. Hashed from the cached 400px thumbnail
 * (made now if missing), which spares decoding every HEIC original again. */
async function hashPhotos(
  label: string,
  photos: TaggedMedia[],
  cacheDir: string,
) {
  const hashed = await mapWithConcurrency(photos, async (m) => {
    try {
      const { hash, width, height } = await processImage(
        m.sourcePath,
        cacheDir,
      );
      const thumb = await readFile(join(cacheDir, `${hash}-thumb.avif`));
      return {
        file: basename(m.sourcePath),
        path: m.sourcePath,
        contentHash: hash,
        perceptualHash: await perceptualHash(thumb),
        width,
        height,
        bytes: (await stat(m.sourcePath)).size,
      };
    } catch (err) {
      console.warn(`[duplicates] ${label}: can't read ${m.sourcePath}:`, err);
      return null;
    }
  });
  await saveSourceIndex(cacheDir);
  return hashed.filter((h) => h !== null);
}

/** Prints each group of duplicate photos, largest copy (most pixels, then
 * biggest file) first, for deleting by hand. Nothing is skipped or written. */
async function reportDuplicates(
  label: string,
  media: TaggedMedia[],
  cacheDir: string,
): Promise<void> {
  const hashed = await hashPhotos(
    label,
    media.filter((m) => m.kind === "photo"),
    cacheDir,
  );
  const byFile = new Map(hashed.map((h) => [h.file, h]));
  const groups = findDuplicateGroups(hashed);
  if (groups.length === 0) return;
  console.log(
    `[duplicates] ${label}: ${groups.length} group(s) of duplicate photos, still on the site — delete the copies you don't want`,
  );
  for (const group of groups) {
    const how =
      group.kind === "exact" ? "exact" : `near, distance ${group.maxDistance}`;
    console.log(`  ${how}:`);
    const copies = group.files
      .map((f) => byFile.get(f)!)
      .sort(
        (a, b) => b.width * b.height - a.width * a.height || b.bytes - a.bytes,
      );
    for (const h of copies) {
      console.log(
        `    ${h.path} (${h.width}x${h.height}, ${Math.round(h.bytes / 1024)} KB)`,
      );
    }
  }
}

/** A plain ingest's first step: renames each media file to its
 * normalizedName (extension matching its content, local date-time prefix —
 * see file-names.ts), carrying the new names into trip.json,
 * template-coords.json and the source-hash index so nothing typed in is
 * lost. Copy-date (mtime) files get no prefix: they have no real time. */
async function normalizeFileNames(slug: string): Promise<void> {
  const tripDir = join(ASSETS_DIR, slug);
  const tripJsonPath = join(tripDir, "trip.json");
  const overrides = await readTripOverrides(tripDir);
  const { isMultiTrip, trips } = await listTrips(slug);

  const planned: { number: number; dir: string; from: string; to: string }[] =
    [];
  for (const { number, dir } of trips) {
    const media = await loadTaggedMedia(
      dir,
      tripBlock(overrides.photos, isMultiTrip, number),
    );
    const taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
    for (const m of media) {
      const from = basename(m.sourcePath);
      const type =
        m.kind === "photo"
          ? sniffImageType(await readHead(m.sourcePath))
          : undefined;
      const wanted = normalizedName(
        from,
        m.takenAtIsMtime ? undefined : m.takenAt,
        type,
      );
      if (wanted === from) continue;
      taken.delete(from.toLowerCase());
      const to = freeName(wanted, taken);
      taken.add(to.toLowerCase());
      planned.push({ number, dir, from, to });
    }
  }
  if (planned.length === 0) return;

  const current = await readFile(tripJsonPath, "utf8").catch(() => null);
  if (current != null) await backUp(tripJsonPath);
  const done: typeof planned = [];
  try {
    for (const r of planned) {
      const to = join(r.dir, r.to);
      // fs.rename replaces an existing file; never let it.
      if (await exists(to)) throw new Error(`${to} already exists`);
      await rename(join(r.dir, r.from), to);
      done.push(r);
    }
  } finally {
    // Even after a failed rename, record the ones that happened.
    for (const r of done) {
      const block = tripBlock(overrides.photos, isMultiTrip, r.number);
      for (const e of allEntries(block)) if (e.file === r.from) e.file = r.to;
    }
    if (current != null) {
      await writeFile(tripJsonPath, JSON.stringify(overrides, null, 2) + "\n");
    }
    const coords = await readTemplateCoords(slug);
    for (const r of done) {
      if (coords[r.from] !== undefined) coords[r.to] = coords[r.from]!;
    }
    for (const r of done) delete coords[r.from];
    await writeTemplateCoords(slug, coords);
    await renameSources(
      join(CACHE_DIR, slug),
      done.map((r) => [join(r.dir, r.from), join(r.dir, r.to)]),
    );
    console.log(
      `[ingest] ${slug}: renamed ${done.length} file(s)${current != null ? "; trip.json backed up" : ""}`,
    );
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

  const rebuild = args.includes("--rebuild");
  const watch = args.includes("--watch");
  const onlySlug = args.find((a) => !a.startsWith("--"));

  if (rebuild) {
    console.log("[ingest] --rebuild: wiping database");
    await prisma.trip.deleteMany(); // cascades to Step/Media
  }
  // --rebuild and --watch only re-ingest: no file renamed, no trip.json
  // written (--watch would otherwise rename photos still being copied in).
  if (rebuild || watch) await ingestAll(onlySlug);
  else await updateTrips(onlySlug);
  if (!watch) await pruneCaches(onlySlug);
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
