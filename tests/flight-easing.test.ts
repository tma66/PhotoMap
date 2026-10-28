import { describe, expect, it } from "vitest";
import { ease, shortenedEase } from "../src/lib/flight-easing";

describe("shortenedEase", () => {
  const warpOnly = shortenedEase({ fullMs: 5000, keepMs: 1500, warpMs: 4000 });
  const e = shortenedEase({
    fullMs: 5000,
    keepMs: 1500,
    warpMs: 4000,
    finishMs: 3450,
    durationMs: 3750,
  });
  const speed = (f: (t: number) => number, ms: number, side: -1 | 1) => {
    const t = ms / 3750;
    const h = 1e-5;
    return side < 0 ? (f(t) - f(t - h)) / h : (f(t + h) - f(t)) / h;
  };

  it("starts at 0 and ends at 1", () => {
    for (const f of [warpOnly, e]) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
  });

  it("matches the full-length ease until keepMs", () => {
    for (const ms of [250, 750, 1200, 1500]) {
      expect(warpOnly(ms / 4000)).toBeCloseTo(ease(ms / 5000), 9);
      expect(e(ms / 3750)).toBeCloseTo(ease(ms / 5000), 9);
    }
  });

  it("matches the warped ease until finishMs", () => {
    for (const ms of [2000, 3000, 3450]) {
      expect(e(ms / 3750)).toBeCloseTo(warpOnly(ms / 4000), 9);
    }
  });

  it("never goes backwards", () => {
    for (const f of [warpOnly, e]) {
      let last = -1;
      for (let i = 0; i <= 1000; i++) {
        const v = f(i / 1000);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
    }
  });

  it("keeps its speed across keepMs and finishMs", () => {
    for (const ms of [1500, 3450]) {
      expect(speed(e, ms, 1)).toBeCloseTo(speed(e, ms, -1), 2);
    }
  });
});
