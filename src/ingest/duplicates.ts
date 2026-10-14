// Finds duplicate photos within a trip, for `npm run ingest --
// --find-duplicates`: exact copies (same content hash) and near copies — the
// same picture resized, re-compressed or converted (e.g. a HEIC and its
// exported JPEG), found by a perceptual difference hash. Report only.
import sharp from "sharp";

// 16 rows of 17 gray pixels -> 16x16 left/right brightness comparisons.
const HASH_SIZE = 16;
/** Most differing bits (of 256) for two images to count as the same picture. */
export const NEAR_MAX_DISTANCE = 10;

/** 256-bit difference hash (dHash) of an image, as 32 bytes. */
export async function perceptualHash(image: Buffer): Promise<Uint8Array> {
  const pixels = await sharp(image)
    .grayscale()
    .resize(HASH_SIZE + 1, HASH_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();
  const bits = new Uint8Array((HASH_SIZE * HASH_SIZE) / 8);
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const row = y * (HASH_SIZE + 1);
      if (pixels[row + x]! > pixels[row + x + 1]!) {
        const bit = y * HASH_SIZE + x;
        bits[bit >> 3]! |= 1 << (bit & 7);
      }
    }
  }
  return bits;
}

export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i]! ^ b[i]!;
    for (; x; x &= x - 1) distance++;
  }
  return distance;
}

export interface HashedPhoto {
  file: string;
  contentHash: string;
  perceptualHash: Uint8Array;
}

export interface DuplicateGroup {
  /** "exact" when every file in the group has the same content hash. */
  kind: "exact" | "near";
  files: string[];
  /** Largest distance between two linked files (0 for exact). */
  maxDistance: number;
}

/** Groups photos that are exact or near copies of each other (transitively). */
export function findDuplicateGroups(
  photos: HashedPhoto[],
  maxDistance = NEAR_MAX_DISTANCE,
): DuplicateGroup[] {
  const parent = photos.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]!));
  const linkDistance = new Map<number, number>();

  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const a = photos[i]!;
      const b = photos[j]!;
      const d =
        a.contentHash === b.contentHash
          ? 0
          : hammingDistance(a.perceptualHash, b.perceptualHash);
      if (d > maxDistance) continue;
      const [ri, rj] = [root(i), root(j)];
      const worst = Math.max(
        d,
        linkDistance.get(ri) ?? 0,
        linkDistance.get(rj) ?? 0,
      );
      parent[rj] = ri;
      linkDistance.set(ri, worst);
    }
  }

  const groups = new Map<number, HashedPhoto[]>();
  photos.forEach((p, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([r, members]) => ({
      kind:
        new Set(members.map((m) => m.contentHash)).size === 1
          ? "exact"
          : "near",
      files: members.map((m) => m.file),
      maxDistance: linkDistance.get(r) ?? 0,
    }));
}
