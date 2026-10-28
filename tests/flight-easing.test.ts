import { describe, expect, it } from "vitest";
import { ease, shortenedEase } from "../src/lib/flight-easing";

describe("shortenedEase", () => {
  const e = shortenedEase(5000, 1500, 4000);

  it("starts at 0 and ends at 1", () => {
    expect(e(0)).toBeCloseTo(0, 6);
    expect(e(1)).toBeCloseTo(1, 6);
  });

  it("matches the full-length ease until keepMs", () => {
    for (const ms of [250, 750, 1200, 1500]) {
      expect(e(ms / 4000)).toBeCloseTo(ease(ms / 5000), 9);
    }
  });

  it("never goes backwards", () => {
    let last = -1;
    for (let i = 0; i <= 1000; i++) {
      const v = e(i / 1000);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("keeps its speed across keepMs", () => {
    const h = 1e-5;
    const t = 1500 / 4000;
    const before = (e(t) - e(t - h)) / h;
    const after = (e(t + h) - e(t)) / h;
    expect(after).toBeCloseTo(before, 2);
  });
});
