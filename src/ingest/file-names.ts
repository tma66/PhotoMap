// File renames done by a plain ingest: an image's extension matched to
// its content (many "HEIC" exports are really JPEGs, which Finder can't
// preview), and a local date-time prefix so a folder sorts by time.
import { extname } from "node:path";

/** "20221225-153803_" — already on a file, it's never added again. */
export const TIME_PREFIX = /^\d{8}-\d{6}_/;

const EXT_BY_TYPE = { jpeg: ".jpg", heif: ".heic", png: ".png" } as const;
type ImageType = keyof typeof EXT_BY_TYPE;
const EXTS: Record<ImageType, string[]> = {
  jpeg: [".jpg", ".jpeg"],
  heif: [".heic", ".heif"],
  png: [".png"],
};

/** An image's real type from its first 12 bytes. */
export function sniffImageType(head: Buffer): ImageType | undefined {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.toString("latin1", 1, 4) === "PNG") return "png";
  if (head.toString("latin1", 4, 8) === "ftyp") {
    const brand = head.toString("latin1", 8, 12);
    if (/^(hei|hev|mif1|msf1)/.test(brand)) return "heif";
  }
  return undefined;
}

/** `takenAt` is local wall-clock time encoded as UTC (see exif.ts). */
export function timePrefix(takenAt: Date): string {
  const iso = takenAt.toISOString(); // 2022-12-25T15:38:03.000Z
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}_`;
}

/** The name `name` should have: its extension matching `type` (when known),
 * and the time prefix when it has a real time and none yet. */
export function normalizedName(
  name: string,
  takenAt: Date | undefined,
  type: ImageType | undefined,
): string {
  const ext = extname(name);
  let stem = name.slice(0, name.length - ext.length);
  let newExt = ext;
  if (type && !EXTS[type].includes(ext.toLowerCase())) {
    newExt = EXT_BY_TYPE[type];
  }
  if (takenAt && !TIME_PREFIX.test(stem)) stem = timePrefix(takenAt) + stem;
  return stem + newExt;
}

/** `name`, or `name-2`, `name-3`... — the first not in `taken` (compared
 * case-insensitively, as APFS does). */
export function freeName(name: string, taken: Set<string>): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}
