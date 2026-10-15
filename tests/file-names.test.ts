import { describe, expect, it } from "vitest";
import {
  freeName,
  normalizedName,
  sniffImageType,
  timePrefix,
} from "../src/ingest/file-names";

const at = new Date("2022-12-25T15:38:03Z"); // local wall-clock as UTC

describe("sniffImageType", () => {
  it("reads JPEG, PNG and HEIF signatures", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(Buffer.from("\x89PNG\r\n\x1a\n", "latin1"))).toBe(
      "png",
    );
    expect(sniffImageType(Buffer.from("\0\0\0\x18ftypheic", "latin1"))).toBe(
      "heif",
    );
    expect(sniffImageType(Buffer.from("\0\0\0\x18ftypqt  ", "latin1"))).toBe(
      undefined,
    );
  });
});

describe("normalizedName", () => {
  it("prefixes the local time and fixes a JPEG named .HEIC", () => {
    expect(timePrefix(at)).toBe("20221225-153803_");
    expect(normalizedName("IMG_4842.HEIC", at, "jpeg")).toBe(
      "20221225-153803_IMG_4842.jpg",
    );
  });

  it("keeps a matching extension and an existing prefix", () => {
    expect(normalizedName("IMG_1.JPEG", at, "jpeg")).toBe(
      "20221225-153803_IMG_1.JPEG",
    );
    expect(normalizedName("20221225-153803_IMG_1.jpg", at, "jpeg")).toBe(
      "20221225-153803_IMG_1.jpg",
    );
  });

  it("gives a HEIC named .jpeg its own extension; no time, no prefix", () => {
    expect(normalizedName("IMG_2.jpeg", undefined, "heif")).toBe("IMG_2.heic");
    expect(normalizedName("clip.MOV", undefined, undefined)).toBe("clip.MOV");
  });
});

describe("freeName", () => {
  it("adds -2, -3... on a case-insensitive clash", () => {
    const taken = new Set(["a.jpg", "a-2.jpg"]);
    expect(freeName("A.jpg", taken)).toBe("A-3.jpg");
    expect(freeName("b.jpg", taken)).toBe("b.jpg");
  });
});
