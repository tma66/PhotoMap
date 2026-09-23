import { describe, expect, it } from "vitest";
import { isSafeMediaRequest } from "@/lib/media-path-safety";

const VALID_HASH = "0612bfd0f54277be5a24"; // 20 hex chars

describe("isSafeMediaRequest", () => {
  it("accepts a well-formed thumb/display request", () => {
    expect(isSafeMediaRequest("japan-2025", `${VALID_HASH}-thumb.jpg`)).toBe(
      true,
    );
    expect(isSafeMediaRequest("japan-2025", `${VALID_HASH}-display.jpg`)).toBe(
      true,
    );
  });

  it("rejects path traversal in the slug", () => {
    expect(isSafeMediaRequest("../../etc", `${VALID_HASH}-thumb.jpg`)).toBe(
      false,
    );
    expect(isSafeMediaRequest("..", `${VALID_HASH}-thumb.jpg`)).toBe(false);
  });

  it("rejects path traversal or slashes in the file", () => {
    expect(isSafeMediaRequest("trip", "../../etc/passwd")).toBe(false);
    expect(isSafeMediaRequest("trip", `${VALID_HASH}-thumb.jpg/../x`)).toBe(
      false,
    );
  });

  it("rejects a file that isn't the exact expected shape", () => {
    expect(isSafeMediaRequest("trip", "not-a-hash-thumb.jpg")).toBe(false);
    expect(isSafeMediaRequest("trip", `${VALID_HASH}-original.jpg`)).toBe(
      false,
    );
    expect(isSafeMediaRequest("trip", `${VALID_HASH}-thumb.png`)).toBe(false);
    expect(
      isSafeMediaRequest("trip", `${VALID_HASH.slice(0, 10)}-thumb.jpg`),
    ).toBe(false);
  });

  it("rejects an absolute path slug", () => {
    expect(isSafeMediaRequest("/etc", `${VALID_HASH}-thumb.jpg`)).toBe(false);
  });
});
