import { describe, expect, it } from "vitest";
import { landingTiles, tileUrl } from "@/lib/tile-prefetch";

const SHIBUYA = { lat: 35.6595, lng: 139.7005 };

describe("landingTiles", () => {
  it("includes the tile containing the point at every zoom", () => {
    // Shibuya's z13 tile, from the standard slippy-map formula.
    const tiles = landingTiles(SHIBUYA, 10, 13);
    expect(tiles).toContainEqual({ z: 13, x: 7274, y: 3226 });
    for (const z of [10, 11, 12, 13]) {
      expect(tiles.filter((t) => t.z === z)).toHaveLength(4);
    }
  });

  it("returns adjacent tiles (a 2×2 block)", () => {
    const z13 = landingTiles(SHIBUYA, 13, 13);
    const xs = new Set(z13.map((t) => t.x));
    const ys = new Set(z13.map((t) => t.y));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(1);
  });

  it("wraps columns across the antimeridian", () => {
    const xs = landingTiles({ lat: 0, lng: 179.99 }, 4, 4).map((t) => t.x);
    expect(new Set(xs)).toEqual(new Set([15, 0]));
  });

  it("drops rows past the poles", () => {
    const z1 = landingTiles({ lat: 84, lng: 0 }, 1, 1);
    expect(z1.every((t) => t.y >= 0 && t.y < 2)).toBe(true);
    expect(z1).toHaveLength(2);
  });
});

describe("tileUrl", () => {
  it("fills z, x and y into the template", () => {
    expect(tileUrl("https://t/{z}/{x}/{y}@2x.png", { z: 3, x: 4, y: 5 })).toBe(
      "https://t/3/4/5@2x.png",
    );
  });
});
