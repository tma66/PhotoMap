import { describe, expect, it } from "vitest";
import { summarizeDaytime } from "../src/ingest/weather";

/** 24 hourly values: `base` everywhere, with `overrides` at given hours. */
function hours<T>(base: T, overrides: Record<number, T> = {}): T[] {
  return Array.from({ length: 24 }, (_, h) => overrides[h] ?? base);
}

describe("summarizeDaytime", () => {
  it("ignores an overnight shower and uses the daytime high", () => {
    // San Francisco, 2021-02-20: drizzle at 2-3am, then a mostly clear day.
    const temps = hours(50, { 8: 47.8, 16: 58.4 });
    const codes = hours(0, { 2: 53, 3: 53, 10: 2, 11: 2, 12: 2, 14: 2, 15: 1 });
    expect(summarizeDaytime(temps, codes)).toEqual({ tempF: 58, code: 1 });
  });

  it("keeps a passing daytime shower out of the icon", () => {
    const codes = hours(3, { 12: 61, 13: 61 });
    expect(summarizeDaytime(hours(60), codes)?.code).toBe(3);
  });

  it("shows rain once it lasts three daytime hours", () => {
    const codes = hours(2, { 11: 61, 12: 63, 13: 63 });
    expect(summarizeDaytime(hours(60), codes)?.code).toBe(63);
  });

  it("shows fog once it lasts three daytime hours", () => {
    const codes = hours(1, { 9: 45, 10: 45, 11: 45 });
    expect(summarizeDaytime(hours(60), codes)?.code).toBe(45);
  });

  it("skips missing hours, and gives nothing when the daytime is empty", () => {
    const codes = hours<number | null>(null, { 12: 2 });
    expect(summarizeDaytime(hours(60), codes)).toEqual({ tempF: 60, code: 2 });
    expect(summarizeDaytime(hours(null), hours(null))).toBeUndefined();
  });
});
