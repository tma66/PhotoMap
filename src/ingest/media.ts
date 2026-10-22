// Turns a source photo into the derivatives visitors actually receive:
// resized, EXIF-stripped AVIFs plus a tiny base64 blur placeholder. Originals
// never leave this module — only files written under CACHE_DIR are served.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const THUMB_WIDTH = 400;
// Home cards and trip-selector tiles: ~450px wide on screen, sharp at 2x.
const CARD_WIDTH = 800;
// Map pins: 44px circles, sharp at 3x. A long trip zoomed out shows every
// pin at once, and decoded full thumbnails there ran a phone out of memory.
const PIN_WIDTH = 132;
// Full-screen story photos: the widest iPhone screen (18 Pro Max, 1320px)
// at 1:1. Pinch-zoom past 1x softens, as it already did at 1600.
const DISPLAY_WIDTH = 1320;
// Every photo size and video poster. On 10 random photos at 1320px vs the
// old mozjpeg q82: 24% smaller on average (5–39%), SSIMULACRA2 78.0 vs 76.3,
// Butteraugli 1.00 vs 1.11. Full-colour 4:4:4 per jakearchibald.com/2026/
// jpeg-xl-vs-avif; effort 7 gained <1 point for 4x the encode time.
// Plays on iOS 16+, Chrome 85+, Samsung Internet 14+.
const AVIF = { quality: 65, effort: 4, chromaSubsampling: "4:4:4" } as const;

interface MediaDerivative {
  hash: string;
  width: number;
  height: number;
  placeholder: string; // small base64 data URI, used as a blur-up placeholder
  /** Video only — the transcoded derivative's length. */
  durationSec?: number;
}

/** Everything in MediaDerivative except the hash itself — cached alongside
 * the resized AVIFs so a re-ingest of an unchanged photo can skip straight
 * to reading this back instead of redoing HEIC conversion + resizing. */
type CachedMeta = Omit<MediaDerivative, "hash">;

function hashFile(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 20);
}

function derivativePaths(cacheDir: string, hash: string) {
  const path = (suffix: string) => join(cacheDir, `${hash}-${suffix}`);
  return {
    thumb: path("thumb.avif"),
    card: path("card.avif"),
    pin: path("pin.avif"),
    display: path("display.avif"),
    hevc: path("hevc.mp4"),
    meta: path("meta.json"),
  };
}

// Source file -> content hash, per cache dir (sources.json), keyed by the
// file's path, size and mtime — so re-ingesting an unchanged photo doesn't
// read the whole original just to hash it before finding it's cached.
const sourceIndexes = new Map<string, Promise<Record<string, string>>>();

function sourceIndex(cacheDir: string): Promise<Record<string, string>> {
  let index = sourceIndexes.get(cacheDir);
  if (!index) {
    index = readFile(join(cacheDir, "sources.json"), "utf8")
      .then((raw) => JSON.parse(raw) as Record<string, string>)
      .catch(() => ({}));
    sourceIndexes.set(cacheDir, index);
  }
  return index;
}

/** The source's content hash, plus its bytes when they had to be read. */
async function hashSource(
  absPath: string,
  cacheDir: string,
): Promise<{ hash: string; source?: Buffer }> {
  const { size, mtimeMs } = await stat(absPath);
  const key = `${absPath}|${size}|${mtimeMs}`;
  const index = await sourceIndex(cacheDir);
  const known = index[key];
  if (known) return { hash: known };
  const source = await readFile(absPath);
  const hash = hashFile(source);
  index[key] = hash;
  return { hash, source };
}

/** Persists the hashes learned while processing a trip's media. */
export async function saveSourceIndex(cacheDir: string): Promise<void> {
  const index = await sourceIndexes.get(cacheDir);
  if (index)
    await writeFile(join(cacheDir, "sources.json"), JSON.stringify(index));
}

/** Deletes this cache folder's derivatives (`<hash>-*`) that no current
 * source file has the hash of — photos/videos since deleted or edited.
 * Run after pruneSourceIndex. Based on the folder's files, not the DB, so a
 * photo the site leaves out (no GPS, skipped trip) keeps its cache. An
 * empty index can't say what's in use, so nothing is deleted then. */
export async function pruneDerivatives(
  cacheDir: string,
): Promise<{ files: number; bytes: number }> {
  const inUse = new Set(Object.values(await sourceIndex(cacheDir)));
  let files = 0;
  let bytes = 0;
  if (inUse.size === 0) return { files, bytes };
  for (const name of await readdir(cacheDir).catch(() => [])) {
    const hash = /^([a-f0-9]{20})-/.exec(name)?.[1];
    if (!hash || inUse.has(hash)) continue;
    const path = join(cacheDir, name);
    bytes += (await stat(path)).size;
    await rm(path, { force: true });
    files++;
  }
  return { files, bytes };
}

/** Re-keys renamed source files (size and mtime survive a rename), so they
 * aren't re-read just to be hashed. */
export async function renameSources(
  cacheDir: string,
  renames: [from: string, to: string][],
): Promise<void> {
  const index = await sourceIndex(cacheDir);
  for (const key of Object.keys(index)) {
    for (const [from, to] of renames) {
      if (!key.startsWith(`${from}|`)) continue;
      index[to + key.slice(from.length)] = index[key]!;
      delete index[key];
    }
  }
  await mkdir(cacheDir, { recursive: true });
  await saveSourceIndex(cacheDir);
}

/** Drops entries for files that are gone or changed (their key's path, size
 * or mtime no longer matches); returns how many. Run by --rebuild. */
export async function pruneSourceIndex(cacheDir: string): Promise<number> {
  const index = await sourceIndex(cacheDir);
  let pruned = 0;
  for (const key of Object.keys(index)) {
    const path = key.split("|").slice(0, -2).join("|");
    const now = await stat(path).catch(() => null);
    if (now && key === `${path}|${now.size}|${now.mtimeMs}`) continue;
    delete index[key];
    pruned++;
  }
  if (pruned > 0) await saveSourceIndex(cacheDir);
  return pruned;
}

/** A smaller copy of an existing derivative, if missing — backfills caches
 * written before that size existed without redoing HEIC conversion. */
async function ensureResized(
  fromPath: string,
  toPath: string,
  width: number,
): Promise<void> {
  try {
    await access(toPath);
  } catch {
    await sharp(fromPath)
      .resize({ width, withoutEnlargement: true })
      .avif(AVIF)
      .toFile(toPath);
  }
}

async function ensureCardAndPin(
  paths: ReturnType<typeof derivativePaths>,
): Promise<void> {
  await Promise.all([
    ensureResized(paths.display, paths.card, CARD_WIDTH),
    ensureResized(paths.thumb, paths.pin, PIN_WIDTH),
  ]);
}

/**
 * sharp's prebuilt binaries can't decode HEIC/HEIF (patent licensing), so on
 * macOS we shell out to the built-in `sips` tool to get a JPEG first. Not
 * macOS, or `sips` missing -> caller should skip the file and log a warning.
 */
async function heicToJpegBuffer(absPath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "photomap-heic-"));
  const outPath = join(dir, "out.jpg");
  try {
    await execFileAsync("sips", [
      "-s",
      "format",
      "jpeg",
      // Near-lossless: it's only an intermediate, resized and re-encoded next.
      "-s",
      "formatOptions",
      "best",
      absPath,
      "--out",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const HEIC_EXT = new Set([".heic", ".heif"]);
// HEIF brands (ISO BMFF `ftyp` box) sharp can't decode; AVIF ("avif") it can.
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/** A file's first 12 bytes — enough to tell its image type. */
export async function readHead(path: string): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    return head;
  } finally {
    await fh.close();
  }
}

/** By extension, or by content: some exports save a HEIC as `.jpeg`. */
async function isHeif(absPath: string, source?: Buffer): Promise<boolean> {
  if (HEIC_EXT.has(extname(absPath).toLowerCase())) return true;
  const head = source?.subarray(0, 12) ?? (await readHead(absPath));
  return (
    head.toString("latin1", 4, 8) === "ftyp" &&
    HEIF_BRANDS.has(head.toString("latin1", 8, 12))
  );
}

/** Resizes an already-decoded image buffer into `cacheDir/<hash>-thumb.avif`,
 * `-pin.avif`, `-card.avif` and `-display.avif`, plus a tiny inline blur placeholder — shared by
 * processImage (the source photo itself) and processVideo (an extracted
 * poster frame). Doesn't write the `-meta.json` cache file itself, since
 * processVideo has an extra field (durationSec) to merge in first. */
async function writeResizedDerivatives(
  decodable: Buffer,
  cacheDir: string,
  hash: string,
): Promise<CachedMeta> {
  const paths = derivativePaths(cacheDir, hash);
  const image = sharp(decodable).rotate(); // rotate() bakes in EXIF orientation before we strip metadata
  const metadata = await image.metadata();
  const resized = (width: number, path: string) =>
    image
      .clone()
      .resize({ width, withoutEnlargement: true })
      .avif(AVIF)
      .toFile(path);

  const [, , , , placeholderBuf] = await Promise.all([
    resized(DISPLAY_WIDTH, paths.display),
    resized(CARD_WIDTH, paths.card),
    resized(THUMB_WIDTH, paths.thumb),
    resized(PIN_WIDTH, paths.pin),
    image
      .clone()
      .resize({ width: 24 })
      .jpeg({ quality: 40, mozjpeg: true })
      .toBuffer(),
  ]);

  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    placeholder: `data:image/jpeg;base64,${placeholderBuf.toString("base64")}`,
  };
}

/**
 * Decode a source image (converting HEIC via `sips` first if needed) and
 * write its AVIFs — resized and EXIF-stripped by sharp's default
 * behaviour — via writeResizedDerivatives, plus `-meta.json`.
 * Returns the shared hash + original dimensions + a tiny inline placeholder.
 *
 * The hash is of the *source* file's own bytes (not the converted JPEG), so
 * it's known before any HEIC conversion or resizing happens — letting a
 * re-ingest of an unchanged photo skip straight to a cache hit below,
 * without ever shelling out to `sips` or running it through sharp.
 */
export async function processImage(
  absPath: string,
  cacheDir: string,
): Promise<MediaDerivative> {
  await mkdir(cacheDir, { recursive: true });
  const { hash, source } = await hashSource(absPath, cacheDir);
  const paths = derivativePaths(cacheDir, hash);

  const cached = await readCachedMeta(paths.meta, [paths.display, paths.thumb]);
  if (cached) {
    await ensureCardAndPin(paths);
    return { hash, ...cached };
  }

  const decodable = (await isHeif(absPath, source))
    ? await heicToJpegBuffer(absPath)
    : (source ?? (await readFile(absPath)));

  const meta = await writeResizedDerivatives(decodable, cacheDir, hash);
  await writeFile(paths.meta, JSON.stringify(meta));

  return { hash, ...meta };
}

/**
 * Transcode a source video to HEVC/AAC MP4 (`cacheDir/<hash>-hevc.mp4`),
 * plus poster-frame AVIFs (same set as a photo's,
 * so the carousel/story views need no video-specific cover handling) and
 * the source's own duration. Same source-hash cache-skip as processImage.
 */
export async function processVideo(
  absPath: string,
  cacheDir: string,
): Promise<MediaDerivative> {
  await mkdir(cacheDir, { recursive: true });
  const { hash } = await hashSource(absPath, cacheDir);
  const paths = derivativePaths(cacheDir, hash);

  const cached = await readCachedMeta(paths.meta, [paths.display, paths.thumb]);
  if (cached) {
    await ensureCardAndPin(paths);
    // Cached before HEVC: only the video itself is missing.
    if (!(await exists(paths.hevc))) await transcodeVideo(absPath, paths.hevc);
    return { hash, ...cached };
  }

  const [, posterBuf] = await Promise.all([
    (await exists(paths.hevc)) || transcodeVideo(absPath, paths.hevc),
    extractPosterFrame(absPath),
  ]);
  const durationSec = await probeDurationSec(paths.hevc);

  const meta: CachedMeta = {
    ...(await writeResizedDerivatives(posterBuf, cacheDir, hash)),
    durationSec,
  };
  await writeFile(paths.meta, JSON.stringify(meta));

  return { hash, ...meta };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** HEVC (x265 CRF 26, slow) — on Japan #2's three biggest clips, VMAF
 * 93.5–94.7 at ~12% smaller than medium CRF 24 (92.9–94.5), itself VMAF ~94
 * vs ~89 for the old H.264 (veryfast CRF 23) at 3–39% smaller; plays on
 * iPhones and recent Android phones (Chrome uses the hardware decoder).
 * 10-bit HDR (iPhone HLG) sources stay 10-bit HDR. Capped at DISPLAY_WIDTH
 * like photos: portrait 1080p is untouched, landscape 1080p drops to what a
 * phone held upright shows. `-2` keeps the height even; `hvc1` is the tag
 * Safari needs; `faststart` lets playback begin before the download ends.
 * Written to a temp name first so an interrupted encode isn't later taken
 * for a finished one. */
async function transcodeVideo(absPath: string, outPath: string): Promise<void> {
  const partPath = `${outPath}.part`;
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      absPath,
      "-vf",
      `scale='min(${DISPLAY_WIDTH},iw)':-2`,
      "-c:v",
      "libx265",
      "-preset",
      "slow",
      "-crf",
      "26",
      "-x265-params",
      "log-level=error",
      "-tag:v",
      "hvc1",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      partPath,
    ],
    { maxBuffer: 1024 * 1024 * 10 },
  );
  await rename(partPath, outPath);
}

/** A frame just past the very start (0 can land on a black/garbage frame on
 * some encoders) as a JPEG buffer, for writeResizedDerivatives to treat like
 * any other source image. */
async function extractPosterFrame(absPath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      "0.1",
      "-i",
      absPath,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 * 50 },
  );
  return stdout;
}

async function probeDurationSec(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    videoPath,
  ]);
  const data = JSON.parse(stdout) as { format?: { duration?: string } };
  return data.format?.duration ? Number(data.format.duration) : 0;
}

/** Reads back a previous run's cached metadata, only if it and every
 * derivative file it should have written are still present — any missing
 * means a full (re)process is needed. */
async function readCachedMeta(
  metaPath: string,
  derivativePaths: string[],
): Promise<CachedMeta | undefined> {
  try {
    const [metaRaw] = await Promise.all([
      readFile(metaPath, "utf8"),
      ...derivativePaths.map((p) => access(p)),
    ]);
    return JSON.parse(metaRaw) as CachedMeta;
  } catch {
    return undefined;
  }
}
