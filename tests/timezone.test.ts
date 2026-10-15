import { describe, expect, it } from "vitest";
import { localizeByNearestOffset, localizeInstant } from "@/ingest/timezone";

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

describe("localizeByNearestOffset", () => {
  it("shifts a UTC-only item by the nearest offset-tagged item's offset", () => {
    // A UTC-only video at 03:06 UTC; photos that evening at UTC-5.
    const video = {
      takenAt: new Date("2024-11-28T03:06:31Z"),
      takenAtIsExact: true,
    };
    const media = [
      // Far away in time, different offset: must not be picked.
      { takenAt: new Date("2024-11-20T12:00:00Z"), utcOffsetMin: 60 },
      { takenAt: new Date("2024-11-27T21:50:00Z"), utcOffsetMin: -300 },
      video,
    ];
    localizeByNearestOffset(media);
    expect(video.takenAt.toISOString()).toBe("2024-11-27T22:06:31.000Z");
  });

  it("leaves items with a coordinate, or with no offset anywhere, alone", () => {
    const withGps = {
      takenAt: new Date("2024-11-28T03:06:31Z"),
      takenAtIsExact: true,
      lat: 1,
    };
    localizeByNearestOffset([
      withGps,
      { takenAt: new Date("2024-11-27T21:50:00Z"), utcOffsetMin: -300 },
    ]);
    expect(withGps.takenAt.toISOString()).toBe("2024-11-28T03:06:31.000Z");

    const lone = {
      takenAt: new Date("2024-11-28T03:06:31Z"),
      takenAtIsExact: true,
    };
    localizeByNearestOffset([lone]);
    expect(lone.takenAt.toISOString()).toBe("2024-11-28T03:06:31.000Z");
  });
});
