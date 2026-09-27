import exifr from "exifr";
const parseExif = exifr.parse;
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TaggedMedia } from "./steps";

const execFileAsync = promisify(execFile);

// EXIF's DateTimeOriginal/CreateDate tags carry no timezone — they're just
// the camera's wall-clock reading at capture, i.e. already local time at
// wherever the photo was taken. exifr's default reviver parses that raw
// "YYYY:MM:DD HH:MM:SS" string via the JS Date constructor's local-time
// form, which silently reinterprets those numbers in *this process's own*
// timezone — shifting every photo by whatever offset separates the
// ingesting machine from the trip's actual location. Overriding the reviver
// to build the Date via `Date.UTC` instead keeps the recorded wall-clock
// numbers exactly as written, so `.toISOString()` (used everywhere for
// day-grouping) reproduces the true local calendar date regardless of what
// timezone this script happens to run in.
const EXIF_DATE_TIME_ORIGINAL = 0x9003;
const EXIF_CREATE_DATE = 0x9004;

/** Builds a Date from local wall-clock parts, encoded as if they were UTC —
 * shared by every parser below, each of which only differs in how it
 * extracts the six numbers from its own source format. */
function encodeLocalAsUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

export function parseExifDateTime(raw: string): Date {
  const [datePart, timePart] = raw.split(" ");
  const [year, month, day] = datePart!.split(":").map(Number);
  const [hour, minute, second] = (timePart ?? "00:00:00")
    .split(":")
    .map(Number);
  return encodeLocalAsUTC(year!, month!, day!, hour!, minute!, second!);
}

const exifRevivers = exifr.tagRevivers.get("exif") as Map<
  number,
  (raw: string) => Date
>;
exifRevivers.set(EXIF_DATE_TIME_ORIGINAL, parseExifDateTime);
exifRevivers.set(EXIF_CREATE_DATE, parseExifDateTime);

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".heic", ".heif", ".png"]);
const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v"]);

/** True for a recognized photo extension — everything else (sidecar files
 * like trip.json, .DS_Store) is skipped by ingestion. */
export function isImageExt(ext: string): boolean {
  return IMAGE_EXT.has(ext.toLowerCase());
}

/** True for a recognized video extension — see isImageExt. */
export function isVideoExt(ext: string): boolean {
  return VIDEO_EXT.has(ext.toLowerCase());
}

// QuickTime/MP4 metadata (read via ffprobe, below) has no EXIF segment at
// all — exifr only parses JPEG/TIFF/PNG/HEIC/AVIF, so video needs its own
// path. "com.apple.quicktime.creationdate" is the device's local wall-clock
// reading *with* its real UTC offset attached (e.g. "2026-08-18T12:19:14
// +0500") — unlike EXIF, which has no offset at all. We still only take the
// local numbers from it (ignoring the offset) and encode them the same
// naive-as-UTC way as parseExifDateTime, for the same reason: day-grouping
// and formatting read the local calendar date off `takenAt` directly, and
// this keeps every code path — photo or video — producing that same
// representation, corrected to a real instant later via localizeInstant.
const QUICKTIME_LOCAL_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;
// "com.apple.quicktime.location.ISO6709", e.g. "+37.386051-122.083855+032.000/".
const ISO6709_COORD = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/;

function parseQuickTimeLocalDateTime(raw: string): Date | undefined {
  const m = QUICKTIME_LOCAL_DATETIME.exec(raw);
  if (!m) return undefined;
  const [, year, month, day, hour, minute, second] = m;
  return encodeLocalAsUTC(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function parseIso6709(raw: string): { lat: number; lng: number } | undefined {
  const m = ISO6709_COORD.exec(raw);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return undefined;
  return { lat, lng };
}

interface FfprobeOutput {
  format?: {
    tags?: {
      creation_time?: string;
      "com.apple.quicktime.creationdate"?: string;
      "com.apple.quicktime.location.ISO6709"?: string;
    };
  };
}

/**
 * Read the bits of video metadata we care about via `ffprobe` (see the
 * comment above QUICKTIME_LOCAL_DATETIME for why this is separate from the
 * EXIF path). Same undefined-on-partial-metadata contract as
 * readMediaMetadata. Duration isn't read here — it's probed off the
 * transcoded derivative instead (src/ingest/media.ts's processVideo), since
 * that's what's actually served/played and re-encoding can shift it slightly.
 */
export async function readVideoMetadata(
  absPath: string,
  fallbackMtime: Date,
): Promise<Omit<TaggedMedia, "sourcePath" | "kind">> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      absPath,
    ]);
    const data = JSON.parse(stdout) as FfprobeOutput;
    const tags = data.format?.tags ?? {};

    const localDateTime = tags["com.apple.quicktime.creationdate"];
    const localParsed = localDateTime
      ? parseQuickTimeLocalDateTime(localDateTime)
      : undefined;

    let takenAt: Date;
    let takenAtIsExact: boolean;
    if (localParsed) {
      takenAt = localParsed;
      takenAtIsExact = false;
    } else if (tags.creation_time) {
      // No Apple local-time tag (e.g. not recorded on an iPhone) —
      // creation_time is already a real absolute UTC instant.
      takenAt = new Date(tags.creation_time);
      takenAtIsExact = true;
    } else {
      takenAt = fallbackMtime;
      takenAtIsExact = true;
    }

    const coord = tags["com.apple.quicktime.location.ISO6709"]
      ? parseIso6709(tags["com.apple.quicktime.location.ISO6709"])
      : undefined;

    return {
      takenAt,
      takenAtIsExact,
      lat: coord?.lat,
      lng: coord?.lng,
    };
  } catch {
    return { takenAt: fallbackMtime, takenAtIsExact: true };
  }
}

/**
 * Read the bits of EXIF metadata we care about. Returns undefined fields
 * rather than throwing when a file has partial/no metadata — ingestion
 * falls back to the file's mtime and drops it from step-grouping if it also
 * has no GPS (still attached to the nearest step by time).
 */
export async function readMediaMetadata(
  absPath: string,
  fallbackMtime: Date,
): Promise<Omit<TaggedMedia, "sourcePath" | "kind">> {
  try {
    // Passing the path (not a pre-read buffer) lets exifr read only the
    // header chunks it needs via its own fs calls, rather than us loading
    // the whole file — a multi-MB HEIC/JPEG — into memory just for this.
    // No `pick` filter: exifr computes `latitude`/`longitude` from the raw
    // GPS tags as a derived step, and `pick` filters before that step runs —
    // restricting to a "latitude"/"longitude" pick silently drops them.
    const tags = await parseExif(absPath, { gps: true });

    const exifDate: Date | undefined =
      tags?.DateTimeOriginal ?? tags?.CreateDate;
    const takenAt: Date = exifDate ?? fallbackMtime;
    const lat = typeof tags?.latitude === "number" ? tags.latitude : undefined;
    const lng =
      typeof tags?.longitude === "number" ? tags.longitude : undefined;
    const caption: string | undefined =
      tags?.description || tags?.ImageDescription || undefined;

    // `takenAtIsExact` marks `takenAt` as a real absolute instant (the
    // file's mtime, used only when EXIF has no date at all) as opposed to a
    // naive local wall-clock value encoded as if it were UTC (the EXIF case
    // above) — the two need different treatment once a coordinate becomes
    // known, see src/ingest/timezone.ts.
    return { takenAt, takenAtIsExact: exifDate == null, lat, lng, caption };
  } catch {
    return { takenAt: fallbackMtime, takenAtIsExact: true };
  }
}
