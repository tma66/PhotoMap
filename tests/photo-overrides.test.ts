import { describe, expect, it } from "vitest";
import {
  buildPhotoTemplate,
  filedDates,
  refreshChangedCoords,
} from "../src/ingest/photo-overrides";
import type { TaggedMedia } from "../src/ingest/steps";

const photo = (file: string, takenAt: string): TaggedMedia => ({
  sourcePath: `/trip/${file}`,
  kind: "photo",
  takenAt: new Date(takenAt),
});

const entry = (file: string) => ({
  file,
  coord: null,
  locationName: null,
  weatherTempF: null,
  weatherCode: null,
});

describe("buildPhotoTemplate", () => {
  it("keeps an existing entry under the date it was filed under", () => {
    const media = [photo("A.jpg", "2026-09-28T10:00:00Z")];
    const existing = { "2026-05-21": [entry("A.jpg")] };
    expect(Object.keys(buildPhotoTemplate(media, existing))).toEqual([
      "2026-05-21",
    ]);
  });

  it("keeps existing entries' order and appends new photos by their date", () => {
    const media = [
      photo("A.jpg", "2026-05-20T08:00:00Z"),
      photo("B.jpg", "2026-05-20T09:00:00Z"),
      photo("C.jpg", "2026-05-20T10:00:00Z"),
      photo("D.jpg", "2026-05-19T10:00:00Z"),
    ];
    const existing = { "2026-05-20": [entry("C.jpg"), entry("A.jpg")] };
    const result = buildPhotoTemplate(media, existing);
    expect(Object.keys(result)).toEqual(["2026-05-19", "2026-05-20"]);
    expect(result["2026-05-20"]!.map((e) => e.file)).toEqual([
      "C.jpg",
      "A.jpg",
      "B.jpg",
    ]);
  });

  it("drops entries for photos no longer on disk", () => {
    const media = [photo("A.jpg", "2026-05-20T08:00:00Z")];
    const existing = { "2026-05-20": [entry("A.jpg"), entry("Gone.jpg")] };
    expect(
      buildPhotoTemplate(media, existing)["2026-05-20"]!.map((e) => e.file),
    ).toEqual(["A.jpg"]);
  });

  it("finds an existing entry filed under another trip's block", () => {
    const media = [photo("A.jpg", "2026-09-28T10:00:00Z")];
    const existing = { "2": { "2026-05-21": [entry("A.jpg")] } };
    expect(Object.keys(buildPhotoTemplate(media, existing))).toEqual([
      "2026-05-21",
    ]);
  });
});

describe("filedDates", () => {
  it("maps each file to its date in flat and nested blocks", () => {
    expect(filedDates({ "2026-05-21": [entry("A.jpg")] }).get("A.jpg")).toBe(
      "2026-05-21",
    );
    expect(
      filedDates({ "3": { "2026-05-21": [entry("A.jpg")] } }).get("A.jpg"),
    ).toBe("2026-05-21");
  });
});

describe("refreshChangedCoords", () => {
  const PARIS = "48.8566,2.3522";
  const ROME = "41.9028,12.4964";
  const withCoord = (coord: string, locationName: string) => ({
    file: "A.jpg",
    coord,
    locationName,
    weatherTempF: 70,
    weatherCode: 1,
  });

  it("re-derives name and clears weather when the coord changed", () => {
    const e = withCoord(ROME, "Hand-typed");
    const block = { "2026-05-20": [e] };
    expect(refreshChangedCoords(block, { "A.jpg": PARIS }, true)).toEqual([
      "A.jpg",
    ]);
    expect(e.locationName).not.toBe("Hand-typed");
    expect(e.weatherTempF).toBeNull();
  });

  it("keeps hand-typed name and weather while the coord is unchanged", () => {
    const e = withCoord(PARIS, "Hand-typed");
    expect(
      refreshChangedCoords({ "2026-05-20": [e] }, { "A.jpg": PARIS }, true),
    ).toEqual([]);
    expect(e.locationName).toBe("Hand-typed");
    expect(e.weatherTempF).toBe(70);
  });

  it("with no record, refreshes only a name that doesn't match the coord", () => {
    const stale = withCoord(ROME, "Paris");
    refreshChangedCoords({ "2026-05-20": [stale] }, {}, true);
    const derived = stale.locationName;
    const inSync = withCoord(ROME, derived!);
    expect(refreshChangedCoords({ "2026-05-20": [inSync] }, {}, true)).toEqual(
      [],
    );
    expect(inSync.weatherTempF).toBe(70);
  });

  it("keeps weather when weather fetching is off", () => {
    const e = withCoord(ROME, "Paris");
    refreshChangedCoords({ "2026-05-20": [e] }, { "A.jpg": PARIS }, false);
    expect(e.weatherTempF).toBe(70);
  });
});
