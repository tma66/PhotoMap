import { describe, expect, it } from "vitest";
import {
  countryCodeToFlagEmoji,
  formatDayMonth,
  formatDistance,
  formatTravelGap,
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

describe("formatTravelGap", () => {
  it("formats minutes, hours, and days appropriately", () => {
    const base = Date.parse("2025-06-10T09:00:00Z");
    expect(formatTravelGap(base, base + 30 * 60_000)).toBe("30 minutes");
    expect(formatTravelGap(base, base + 4 * 3_600_000)).toBe("4 hours");
    expect(formatTravelGap(base, base + 2 * 86_400_000)).toBe("2 days");
  });

  it("never goes negative for an out-of-order pair", () => {
    const base = Date.parse("2025-06-10T09:00:00Z");
    expect(formatTravelGap(base, base - 10_000)).toBe("1 minute");
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
    // Midday, not midnight: keeps this stable regardless of the local
    // timezone the test runs in (formatDayMonth uses toLocaleDateString,
    // which renders in local time).
    expect(formatDayMonth(new Date("2025-07-13T12:00:00Z"))).toMatch(/13/);
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
