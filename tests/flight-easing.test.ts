import { describe, expect, it } from "vitest";
import { ease, trimmedEase } from "../src/lib/flight-easing";

describe("trimmedEase", () => {
  const e = trimmedEase(5000, 3600, 4300);

  it("starts at 0 and ends at 1", () => {
    expect(e(0)).toBeCloseTo(0, 6);
    expect(e(1)).toBeCloseTo(1, 6);
  });

  it("matches the full-length ease until the switch", () => {
    for (const ms of [500, 1500, 2500, 3600]) {
      expect(e(ms / 4300)).toBeCloseTo(ease(ms / 5000), 9);
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

  it("keeps its speed across the switch", () => {
    const h = 1e-4;
    const t = 3600 / 4300;
    const before = (e(t) - e(t - h)) / h;
    const after = (e(t + h) - e(t)) / h;
    expect(after).toBeCloseTo(before, 2);
  });
});
