import { describe, expect, it } from "vitest";
import { parseUtcOffset } from "@/ingest/exif";

describe("parseUtcOffset", () => {
  it("reads EXIF and QuickTime offset forms", () => {
    expect(parseUtcOffset("+05:00")).toBe(300);
    expect(parseUtcOffset("-08:00")).toBe(-480);
    expect(parseUtcOffset("2026-08-18T12:19:14+0530")).toBe(330);
    expect(parseUtcOffset(undefined)).toBeUndefined();
  });
});
