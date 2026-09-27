import { describe, expect, it } from "vitest";
import {
  downsample,
  greatCircleArc,
  haversineKm,
  pathLengthKm,
} from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(
      haversineKm({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 }),
    ).toBe(0);
  });

  it("matches the known Paris-Lyon distance within 1%", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    const km = haversineKm(paris, lyon);
    // Real-world great-circle distance is ~392.6 km.
    expect(km).toBeGreaterThan(388);
    expect(km).toBeLessThan(397);
  });

  it("is symmetric", () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: -5, lng: 100 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe("pathLengthKm", () => {
  it("sums consecutive leg distances", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    const c = { lat: 0, lng: 2 };
    const total = pathLengthKm([a, b, c]);
    expect(total).toBeCloseTo(haversineKm(a, b) + haversineKm(b, c), 6);
  });

  it("is zero for fewer than two points", () => {
    expect(pathLengthKm([])).toBe(0);
    expect(pathLengthKm([{ lat: 1, lng: 1 }])).toBe(0);
  });
});

describe("greatCircleArc", () => {
  it("starts and ends at the given points", () => {
    const a = { lat: 48.85, lng: 2.35 };
    const b = { lat: 35.68, lng: 139.69 };
    const arc = greatCircleArc(a, b, 10);
    expect(arc[0]!.lat).toBeCloseTo(a.lat, 5);
    expect(arc[0]!.lng).toBeCloseTo(a.lng, 5);
    expect(arc.at(-1)!.lat).toBeCloseTo(b.lat, 5);
    expect(arc.at(-1)!.lng).toBeCloseTo(b.lng, 5);
  });

  it("returns steps+1 points", () => {
    const arc = greatCircleArc({ lat: 0, lng: 0 }, { lat: 10, lng: 10 }, 20);
    expect(arc).toHaveLength(21);
  });

  it("handles identical endpoints without dividing by zero", () => {
    const p = { lat: 12, lng: 34 };
    const arc = greatCircleArc(p, p, 10);
    expect(
      arc.every((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng)),
    ).toBe(true);
  });

  it("keeps longitude continuous across the antimeridian instead of jumping", () => {
    // Real regression: Millbrae, CA -> Singapore. The shortest great-circle
    // route runs west across the Pacific and crosses the antimeridian —
    // atan2's principal-value output used to jump from ~+179 to ~-179
    // between two consecutive points, which a flat (non-globe) map rendered
    // as a straight dashed line across the entire visible world.
    const millbrae = { lat: 37.6, lng: -122.39 };
    const singapore = { lat: 1.3, lng: 103.9 };
    const arc = greatCircleArc(millbrae, singapore, 48);
    for (let i = 1; i < arc.length; i++) {
      expect(Math.abs(arc[i]!.lng - arc[i - 1]!.lng)).toBeLessThan(20);
    }
    // Still the same physical endpoint, even if unwrapped past ±180.
    const last = arc.at(-1)!;
    expect(last.lat).toBeCloseTo(singapore.lat, 5);
    expect(((last.lng % 360) + 360) % 360).toBeCloseTo(
      ((singapore.lng % 360) + 360) % 360,
      5,
    );
  });
});

describe("downsample", () => {
  it("returns the input unchanged when already short enough", () => {
    const points = [1, 2, 3];
    expect(downsample(points, 5)).toEqual(points);
  });

  it("keeps the first and last point", () => {
    const points = Array.from({ length: 100 }, (_, i) => i);
    const result = downsample(points, 10);
    expect(result[0]).toBe(0);
    expect(result.at(-1)).toBe(99);
    expect(result).toHaveLength(10);
  });
});
