import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  findDuplicateGroups,
  hammingDistance,
  perceptualHash,
  type HashedPhoto,
} from "../src/ingest/duplicates";

// A left-to-right gradient with a dark square: something with structure.
async function image(width: number, squareAt: number, quality = 90) {
  const w = 200;
  const h = 150;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inSquare = x >= squareAt && x < squareAt + 50 && y >= 40 && y < 90;
      const v = inSquare ? 20 : Math.round((x / w) * 255);
      raw.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .resize({ width })
    .jpeg({ quality })
    .toBuffer();
}

const photo = (file: string, contentHash: string, hash: Uint8Array) =>
  ({ file, contentHash, perceptualHash: hash }) satisfies HashedPhoto;

describe("perceptualHash", () => {
  it("matches a resized, re-compressed copy and not a different picture", async () => {
    const original = await perceptualHash(await image(200, 20));
    const copy = await perceptualHash(await image(120, 20, 40));
    const other = await perceptualHash(await image(200, 130));
    expect(hammingDistance(original, copy)).toBeLessThanOrEqual(10);
    expect(hammingDistance(original, other)).toBeGreaterThan(10);
  });
});

describe("findDuplicateGroups", () => {
  const zero = new Uint8Array(32);
  const far = new Uint8Array(32).fill(0xff);
  const near = Uint8Array.from(zero, (_, i) => (i === 0 ? 0b111 : 0));

  it("reports exact copies, near copies and leaves singles out", () => {
    const groups = findDuplicateGroups([
      photo("A.jpg", "h1", zero),
      photo("A (1).jpg", "h1", zero),
      photo("B.heic", "h2", far),
      photo(
        "B.jpeg",
        "h3",
        Uint8Array.from(far, (v, i) => (i ? v : 0xfe)),
      ),
      photo("C.jpg", "h4", near),
    ]);
    expect(groups).toEqual([
      { kind: "near", files: ["A.jpg", "A (1).jpg", "C.jpg"], maxDistance: 3 },
      { kind: "near", files: ["B.heic", "B.jpeg"], maxDistance: 1 },
    ]);
  });

  it("calls a group of identical files exact", () => {
    expect(
      findDuplicateGroups([
        photo("A.jpg", "h1", zero),
        photo("B.jpg", "h1", zero),
      ]),
    ).toEqual([{ kind: "exact", files: ["A.jpg", "B.jpg"], maxDistance: 0 }]);
  });
});
