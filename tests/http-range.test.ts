import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/lib/http-range";

const SIZE = 1000;

describe("parseByteRange", () => {
  it("returns undefined when there's no range header", () => {
    expect(parseByteRange(null, SIZE)).toBeUndefined();
  });

  it("parses a normal start-end range", () => {
    expect(parseByteRange("bytes=100-199", SIZE)).toEqual({
      start: 100,
      end: 199,
    });
  });

  it("parses an open-ended range as start to the last byte", () => {
    expect(parseByteRange("bytes=900-", SIZE)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it("parses a suffix range (empty start) as the last N bytes", () => {
    // Regression: this used to be parsed the same way as "bytes=0-500"
    // (first 501 bytes) instead of the last 500.
    expect(parseByteRange("bytes=-500", SIZE)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("clamps a suffix range longer than the file to the whole file", () => {
    expect(parseByteRange("bytes=-5000", SIZE)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("rejects a malformed header", () => {
    expect(parseByteRange("not-a-range", SIZE)).toBeUndefined();
    expect(parseByteRange("bytes=", SIZE)).toBeUndefined();
  });

  it("rejects a range entirely out of bounds", () => {
    expect(parseByteRange("bytes=1000-2000", SIZE)).toBeUndefined();
  });

  it("rejects an inverted range", () => {
    expect(parseByteRange("bytes=500-100", SIZE)).toBeUndefined();
  });
});
