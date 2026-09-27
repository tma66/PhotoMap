import { describe, expect, it } from "vitest";
import {
  countryCodeToFlagEmoji,
  formatDayMonth,
  formatDistance,
  weatherCodeToIcon,
} from "@/lib/format";

describe("countryCodeToFlagEmoji", () => {
  it("builds the regional indicator flag for a valid code", () => {
    expect(countryCodeToFlagEmoji("FR")).toBe("🇫🇷");
    expect(countryCodeToFlagEmoji("jp")).toBe("🇯🇵");
  });

  it("returns empty string for an invalid code", () => {
    expect(countryCodeToFlagEmoji("")).toBe("");
    expect(countryCodeToFlagEmoji("FRA")).toBe("");
    expect(countryCodeToFlagEmoji("1F")).toBe("");
  });
});

describe("weatherCodeToIcon", () => {
  it("maps known WMO codes to an icon", () => {
    expect(weatherCodeToIcon(0)).toBe("☀️");
    expect(weatherCodeToIcon(95)).toBe("⛈️");
  });

  it("falls back gracefully for unknown/missing codes", () => {
    expect(weatherCodeToIcon(null)).toBe("");
    expect(weatherCodeToIcon(undefined)).toBe("");
    expect(weatherCodeToIcon(9999)).toBe("🌡️");
  });
});

describe("formatDayMonth", () => {
  it("formats without a year", () => {
    expect(formatDayMonth(new Date("2025-07-13T12:00:00Z"))).toMatch(/13/);
  });

  it("reads the date in UTC regardless of the server's local timezone", () => {
    // Real regression: this repo's dev/prod machine runs in
    // America/Los_Angeles (UTC-7/8). `arrivedAt`/`takenAt` are naive local
    // wall-clock time encoded as if it were UTC (see
    // src/ingest/timezone.ts) — formatting this early-morning value without
    // pinning timeZone: "UTC" reinterpreted it in the server's own zone and
    // rolled it back to the previous calendar day.
    expect(formatDayMonth(new Date("2026-08-18T01:40:39Z"))).toBe("August 18");
  });
});

describe("formatDistance", () => {
  // UNITS is read once at module load (see lib/format.ts) so this only
  // covers the default; switching units is exercised by running the app
  // with UNITS=mi set, not by mutating process.env mid-test.
  it("defaults to km and rounds to the nearest whole unit", () => {
    expect(formatDistance(100)).toBe("100 km");
    expect(formatDistance(99.6)).toBe("100 km");
  });
});
