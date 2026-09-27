// Turns a source photo into the derivatives visitors actually receive:
// resized, EXIF-stripped JPEGs plus a tiny base64 blur placeholder. Originals
// never leave this module — only files written under CACHE_DIR are served.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const THUMB_WIDTH = 400;
const DISPLAY_WIDTH = 1600;

interface MediaDerivative {
  hash: string;
  width: number;
  height: number;
  placeholder: string; // small base64 data URI, used as a blur-up placeholder
  /** Video only — the transcoded derivative's length. */
  durationSec?: number;
}

/** Everything in MediaDerivative except the hash itself — cached alongside
 * the resized JPEGs so a re-ingest of an unchanged photo can skip straight
 * to reading this back instead of redoing HEIC conversion + resizing. */
type CachedMeta = Omit<MediaDerivative, "hash">;

function hashFile(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 20);
}

/**
 * sharp's prebuilt binaries can't decode HEIC/HEIF (patent licensing), so on
 * macOS we shell out to the built-in `sips` tool to get a JPEG first. Not
 * macOS, or `sips` missing -> caller should skip the file and log a warning.
 */
async function heicToJpegBuffer(absPath: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "travel-steps-heic-"));
  const outPath = join(dir, "out.jpg");
  try {
    await execFileAsync("sips", [
      "-s",
      "format",
      "jpeg",
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

/** Resizes an already-decoded image buffer into `cacheDir/<hash>-thumb.jpg`
 * and `-display.jpg`, plus a tiny inline blur placeholder — shared by
 * processImage (the source photo itself) and processVideo (an extracted
 * poster frame). Doesn't write the `-meta.json` cache file itself, since
 * processVideo has an extra field (durationSec) to merge in first. */
async function writeResizedDerivatives(
  decodable: Buffer,
  cacheDir: string,
  hash: string,
): Promise<CachedMeta> {
  const displayPath = join(cacheDir, `${hash}-display.jpg`);
  const thumbPath = join(cacheDir, `${hash}-thumb.jpg`);

  const image = sharp(decodable).rotate(); // rotate() bakes in EXIF orientation before we strip metadata
  const metadata = await image.metadata();

  const [, , placeholderBuf] = await Promise.all([
    image
      .clone()
      .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(displayPath),
    image
      .clone()
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toFile(thumbPath),
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
 * write `thumb`/`display` JPEGs — resized and EXIF-stripped by sharp's
 * default behaviour — into `cacheDir/<hash>-thumb.jpg` and `-display.jpg`.
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
  const source = await readFile(absPath);
  const hash = hashFile(source);
  await mkdir(cacheDir, { recursive: true });

  const displayPath = join(cacheDir, `${hash}-display.jpg`);
  const thumbPath = join(cacheDir, `${hash}-thumb.jpg`);
  const metaPath = join(cacheDir, `${hash}-meta.json`);

  const cached = await readCachedMeta(metaPath, [displayPath, thumbPath]);
  if (cached) return { hash, ...cached };

  const ext = extname(absPath).toLowerCase();
  const decodable = HEIC_EXT.has(ext)
    ? await heicToJpegBuffer(absPath)
    : source;

  const meta = await writeResizedDerivatives(decodable, cacheDir, hash);
  await writeFile(metaPath, JSON.stringify(meta));

  return { hash, ...meta };
}

/**
 * Transcode a source video to H.264/AAC MP4 (so it plays in any browser,
 * unlike the HEVC most iPhones record) into `cacheDir/<hash>-video.mp4`,
 * plus a poster-frame `thumb`/`display` JPEG pair (same shape as a photo's,
 * so the carousel/story views need no video-specific cover handling) and
 * the source's own duration. Same source-hash cache-skip as processImage.
 */
export async function processVideo(
  absPath: string,
  cacheDir: string,
): Promise<MediaDerivative> {
  const source = await readFile(absPath);
  const hash = hashFile(source);
  await mkdir(cacheDir, { recursive: true });

  const videoPath = join(cacheDir, `${hash}-video.mp4`);
  const displayPath = join(cacheDir, `${hash}-display.jpg`);
  const thumbPath = join(cacheDir, `${hash}-thumb.jpg`);
  const metaPath = join(cacheDir, `${hash}-meta.json`);

  const cached = await readCachedMeta(metaPath, [
    videoPath,
    displayPath,
    thumbPath,
  ]);
  if (cached) return { hash, ...cached };

  const [, posterBuf] = await Promise.all([
    transcodeVideo(absPath, videoPath),
    extractPosterFrame(absPath),
  ]);
  const durationSec = await probeDurationSec(videoPath);

  const meta: CachedMeta = {
    ...(await writeResizedDerivatives(posterBuf, cacheDir, hash)),
    durationSec,
  };
  await writeFile(metaPath, JSON.stringify(meta));

  return { hash, ...meta };
}

/** H.264/AAC, capped at 1920px wide (source iPhone video is already close to
 * this) — `-2` keeps the height even, required by libx264. `faststart`
 * moves the moov atom to the front so playback can begin before the whole
 * file downloads. */
async function transcodeVideo(absPath: string, outPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      absPath,
      "-vf",
      "scale='min(1920,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { maxBuffer: 1024 * 1024 * 10 },
  );
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
