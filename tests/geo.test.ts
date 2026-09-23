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
