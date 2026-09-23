// Turns a source photo into the derivatives visitors actually receive:
// resized, EXIF-stripped JPEGs plus a tiny base64 blur placeholder. Originals
// never leave this module — only files written under CACHE_DIR are served.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export const THUMB_WIDTH = 400;
export const DISPLAY_WIDTH = 1600;

export interface MediaDerivative {
  hash: string;
  width: number;
  height: number;
  placeholder: string; // small base64 data URI, used as a blur-up placeholder
}

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

/**
 * Decode a source image (converting HEIC via `sips` first if needed) and
 * write `thumb`/`display` JPEGs — resized and EXIF-stripped by sharp's
 * default behaviour — into `cacheDir/<hash>-thumb.jpg` and `-display.jpg`.
 * Returns the shared hash + original dimensions + a tiny inline placeholder.
 */
export async function processImage(
  absPath: string,
  cacheDir: string,
): Promise<MediaDerivative> {
  const ext = extname(absPath).toLowerCase();
  const raw = HEIC_EXT.has(ext)
    ? await heicToJpegBuffer(absPath)
    : await readFile(absPath);

  const hash = hashFile(raw);
  await mkdir(cacheDir, { recursive: true });

  const image = sharp(raw).rotate(); // rotate() bakes in EXIF orientation before we strip metadata
  const metadata = await image.metadata();

  await image
    .clone()
    .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(join(cacheDir, `${hash}-display.jpg`));

  await image
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(join(cacheDir, `${hash}-thumb.jpg`));

  const placeholderBuf = await image
    .clone()
    .resize({ width: 24 })
    .jpeg({ quality: 40 })
    .toBuffer();

  return {
    hash,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    placeholder: `data:image/jpeg;base64,${placeholderBuf.toString("base64")}`,
  };
}
