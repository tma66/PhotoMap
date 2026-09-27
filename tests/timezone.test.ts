import { describe, expect, it } from "vitest";
import { localizeInstant } from "@/ingest/timezone";

describe("localizeInstant", () => {
  it("converts a real UTC instant to local wall-clock time, encoded as UTC", () => {
    // Singapore is UTC+8 year-round (no DST).
    const instant = new Date("2026-01-01T00:30:00Z");
    const singapore = { lat: 1.3521, lng: 103.8198 };
    expect(localizeInstant(instant, singapore).toISOString()).toBe(
      "2026-01-01T08:30:00.000Z",
    );
  });

  it("handles a negative UTC offset, including crossing to the previous day", () => {
    // Los Angeles is UTC-8 in January (standard time, no DST).
    const instant = new Date("2026-01-01T05:00:00Z");
    const losAngeles = { lat: 34.0522, lng: -118.2437 };
    expect(localizeInstant(instant, losAngeles).toISOString()).toBe(
      "2025-12-31T21:00:00.000Z",
    );
  });
});
