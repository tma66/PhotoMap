import { describe, expect, it } from "vitest";
import {
  buildPhotoTemplate,
  filedDates,
  moveEntries,
  refreshChangedCoords,
  sortEntriesByTime,
  isSameCoord,
  nearestCoord,
  misfiledMoves,
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

  it("fills a missing cityName from the coord, next to locationName", () => {
    const media = [photo("A.jpg", "2026-05-20T08:00:00Z")];
    const existing = {
      "2026-05-20": [
        {
          file: "A.jpg",
          coord: "34.0635,-118.4455", // Westwood
          locationName: "Hand-typed",
          weatherTempF: 70,
          weatherCode: 1,
        },
      ],
    };
    const entry = buildPhotoTemplate(media, existing)["2026-05-20"]![0]!;
    expect(entry.cityName).toBe("Los Angeles");
    expect(entry.locationName).toBe("Hand-typed");
    expect(Object.keys(entry).slice(0, 4)).toEqual([
      "file",
      "coord",
      "locationName",
      "cityName",
    ]);
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
    expect(e).toHaveProperty("cityName", "Rome");
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

describe("moveEntries", () => {
  it("moves only the named entries, every field kept, and drops emptied dates", () => {
    const video = {
      file: "IMG_9545.MOV",
      coord: "1.35,103.82",
      locationName: "Marina Bay",
      cityName: "Singapore",
      weatherTempF: 61,
      weatherCode: 2,
    };
    const stay = { ...video, file: "IMG_9600.HEIC" };
    const byDay = {
      "2024-11-29": [stay],
      "2024-11-28": [video],
      "2024-11-27": [{ ...video, file: "IMG_9544.MOV" }],
    };
    moveEntries(byDay, new Map([["IMG_9545.MOV", "2024-11-27"]]));
    expect(Object.keys(byDay)).toEqual(["2024-11-27", "2024-11-29"]);
    expect(byDay["2024-11-27"]![1]).toEqual(video);
    expect(byDay["2024-11-29"]).toEqual([stay]);
  });
});

describe("sortEntriesByTime", () => {
  it("orders each date by time of day, unknown times last in their old order", () => {
    const e = (file: string) => ({
      file,
      coord: null,
      locationName: null,
      cityName: null,
    });
    const byDay = {
      "2024-11-27": [e("late"), e("unknownA"), e("early"), e("unknownB")],
      "2024-11-28": [e("movedByHand"), e("morning")],
    };
    const at = new Map([
      ["late", new Date("2024-11-27T19:09:36Z")],
      ["early", new Date("2024-11-27T17:44:23Z")],
      // Filed under 11/28 by hand; only its time of day counts.
      ["movedByHand", new Date("2024-12-02T10:00:00Z")],
      ["morning", new Date("2024-11-28T08:15:03Z")],
    ]);
    sortEntriesByTime(byDay, at);
    expect(byDay["2024-11-27"].map((x) => x.file)).toEqual([
      "early",
      "late",
      "unknownA",
      "unknownB",
    ]);
    expect(byDay["2024-11-28"].map((x) => x.file)).toEqual([
      "morning",
      "movedByHand",
    ]);
  });
});

describe("misfiledMoves", () => {
  const e = (file: string) => ({
    file,
    coord: null,
    locationName: null,
    cityName: null,
  });
  // Already localized (UTC-8): 2024-11-28 03:09 UTC -> 11/27 19:09 local.
  const local = new Date("2024-11-27T19:09:36Z");
  const utcDay = "2024-11-28";
  const m = (file: string, extra: Partial<TaggedMedia> = {}): TaggedMedia => ({
    sourcePath: `/trip/3/${file}`,
    kind: "video",
    takenAt: local,
    takenAtIsExact: true,
    ...extra,
  });

  it("moves a UTC-only entry still under its UTC date to its local date", () => {
    const byDay = { [utcDay]: [e("IMG_9545.MOV")] };
    expect(misfiledMoves([m("IMG_9545.MOV")], [utcDay], byDay)).toEqual(
      new Map([["IMG_9545.MOV", "2024-11-27"]]),
    );
  });

  it("moves a local-time entry filed under any other date", () => {
    const localTime = { takenAtIsExact: false };
    const byDay = {
      "2024-12-02": [e("resaved.MOV")],
      "2024-11-30": [e("handMoved.HEIC")],
      "2024-11-27": [e("inPlace.HEIC")],
    };
    const moves = misfiledMoves(
      [
        m("resaved.MOV", localTime),
        m("handMoved.HEIC", localTime),
        m("inPlace.HEIC", localTime),
      ],
      ["2024-11-27", "2024-11-27", "2024-11-27"],
      byDay,
    );
    expect(moves).toEqual(
      new Map([
        ["resaved.MOV", "2024-11-27"],
        ["handMoved.HEIC", "2024-11-27"],
      ]),
    );
  });

  it("leaves hand-moved UTC-only entries and copy-date files alone", () => {
    const byDay = {
      "2024-11-26": [e("handMoved.MOV"), e("copied.MOV")],
    };
    const moves = misfiledMoves(
      [m("handMoved.MOV"), m("copied.MOV", { takenAtIsMtime: true })],
      [utcDay, "2024-11-26"],
      byDay,
    );
    expect(moves.size).toBe(0);
  });

  it("leaves a local-time entry filed more than 7 days from its date", () => {
    const byDay = { "2024-11-19": [e("screenRecording.MOV")] };
    const moves = misfiledMoves(
      [m("screenRecording.MOV", { takenAtIsExact: false })],
      ["2024-11-27"],
      byDay,
    );
    expect(moves.size).toBe(0);
  });
});

describe("nearestCoord", () => {
  const at = (file: string, t: string, extra: Partial<TaggedMedia> = {}) => ({
    ...photo(file, t),
    lat: 1.35,
    lng: 103.82,
    ...extra,
  });

  it("takes the nearest item in time, skipping moved, copy-date and coordless ones", () => {
    const target = at("moved.MOV", "2025-04-06T10:00:00Z", { lat: 9, lng: 9 });
    const media = [
      target,
      at("otherMoved.MOV", "2025-04-06T10:01:00Z", { lat: 8, lng: 8 }),
      at("copied.jpg", "2025-04-06T10:02:00Z", { takenAtIsMtime: true }),
      at("noGps.jpg", "2025-04-06T10:03:00Z", {
        lat: undefined,
        lng: undefined,
      }),
      at("near.jpg", "2025-04-06T09:00:00Z", { lat: 22.29, lng: 114.15 }),
      at("far.jpg", "2025-04-06T20:00:00Z"),
    ];
    const moves = new Map([
      ["moved.MOV", "2025-04-06"],
      ["otherMoved.MOV", "2025-04-06"],
    ]);
    expect(nearestCoord(media, target, moves)).toBe("22.29,114.15");
  });
});

describe("isSameCoord", () => {
  it("matches a coord written from GPS, not a nearby or missing one", () => {
    const gps = { lat: 1.3521, lng: 103.8198 };
    expect(isSameCoord({ lat: 1.3521, lng: 103.8198 }, gps)).toBe(true);
    expect(isSameCoord({ lat: 1.3522, lng: 103.8198 }, gps)).toBe(false);
    expect(isSameCoord(undefined, gps)).toBe(false);
  });
});
