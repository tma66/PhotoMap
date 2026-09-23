import exifr from "exifr";
const parseExif = exifr.parse;
import { readFile } from "node:fs/promises";
import type { TaggedMedia } from "./steps";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".heic", ".heif", ".png"]);
const VIDEO_EXT = new Set([".mov", ".mp4"]);

export function mediaTypeForExt(ext: string): "IMAGE" | "VIDEO" | undefined {
  const lower = ext.toLowerCase();
  if (IMAGE_EXT.has(lower)) return "IMAGE";
  if (VIDEO_EXT.has(lower)) return "VIDEO";
  return undefined;
}

/**
 * Read the bits of EXIF/QuickTime metadata we care about. Returns undefined
 * fields rather than throwing when a file has partial/no metadata — ingestion
 * falls back to the file's mtime and drops it from step-grouping if it also
 * has no GPS (still attached to the nearest step by time).
 */
export async function readMediaMetadata(
  absPath: string,
  fallbackMtime: Date,
): Promise<Omit<TaggedMedia, "sourcePath" | "type" | "width" | "height">> {
  try {
    const buf = await readFile(absPath);
    // No `pick` filter here: exifr computes `latitude`/`longitude` from the
    // raw GPS tags as a derived step, and `pick` filters before that step
    // runs — restricting to a "latitude"/"longitude" pick silently drops them.
    const tags = await parseExif(buf, { gps: true });

    const takenAt: Date =
      tags?.DateTimeOriginal ?? tags?.CreateDate ?? fallbackMtime;
    const lat = typeof tags?.latitude === "number" ? tags.latitude : undefined;
    const lng =
      typeof tags?.longitude === "number" ? tags.longitude : undefined;
    const caption: string | undefined =
      tags?.description || tags?.ImageDescription || undefined;

    return { takenAt, lat, lng, caption };
  } catch {
    return { takenAt: fallbackMtime };
  }
}
