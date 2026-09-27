import { describe, expect, it } from "vitest";
import exifr from "exifr";
import { parseExifDateTime } from "@/ingest/exif";

describe("parseExifDateTime", () => {
  it("treats the raw EXIF wall-clock string as UTC, regardless of the machine's own timezone", () => {
    // This test runs in a non-UTC CI/dev timezone on purpose (see
    // vitest config / system TZ) — if a regression reintroduces exifr's
    // default reviver (which reinterprets these numbers in the machine's
    // local timezone), this would fail by exactly that offset.
    expect(parseExifDateTime("2026:08:20 23:45:00").toISOString()).toBe(
      "2026-08-20T23:45:00.000Z",
    );
  });

  it("defaults the time to midnight when only a date is given", () => {
    expect(parseExifDateTime("2026:08:20").toISOString()).toBe(
      "2026-08-20T00:00:00.000Z",
    );
  });
});

describe("exif.ts module side effect", () => {
  it("registers parseExifDateTime as the reviver for DateTimeOriginal/CreateDate", () => {
    const exifRevivers = exifr.tagRevivers.get("exif");
    expect(exifRevivers?.get(0x9003)).toBe(parseExifDateTime);
    expect(exifRevivers?.get(0x9004)).toBe(parseExifDateTime);
  });
});
