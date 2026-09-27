import { describe, expect, it } from "vitest";
import {
  groupIntoSteps,
  inferTransportMode,
  type TaggedMedia,
} from "@/ingest/steps";

function photo(
  lat: number,
  lng: number,
  takenAt: string,
  caption?: string,
): TaggedMedia {
  return {
    sourcePath: `/fake/${takenAt}.jpg`,
    kind: "photo",
    takenAt: new Date(takenAt),
    lat,
    lng,
    caption,
  };
}

function noGpsPhoto(takenAt: string, caption?: string): TaggedMedia {
  return {
    sourcePath: `/fake/${takenAt}.jpg`,
    kind: "photo",
    takenAt: new Date(takenAt),
    caption,
  };
}

describe("groupIntoSteps", () => {
  it("groups nearby same-day photos into one step", () => {
    const media = [
      photo(48.8584, 2.2945, "2025-06-10T09:00:00Z", "a"),
      photo(48.8606, 2.3376, "2025-06-10T14:00:00Z", "b"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.media).toHaveLength(2);
    expect(steps[0]!.captions).toEqual(["a", "b"]);
  });

  it("pins a multi-photo step to its first (preview) photo's coordinate, not an average", () => {
    const media = [
      photo(1.304991, 103.904967, "2025-06-10T09:00:00Z", "cover"),
      photo(1.362389, 103.990124, "2025-06-10T14:00:00Z", "later"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.centroid).toEqual({ lat: 1.304991, lng: 103.904967 });
  });

  it("splits a multi-day stay at the same spot into one step per day", () => {
    // Steps are day-based, not location-based — a stay at one resort for
    // several days is still a Day 1/Day 2/Day 3 progression.
    const media = [
      photo(43.6953, 7.2654, "2025-06-12T18:00:00Z"),
      photo(43.6975, 7.2769, "2025-06-13T20:00:00Z"), // >24h later, same spot
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(2);
  });

  it("does not split same-day photos at the same spot, even hours apart", () => {
    const media = [
      photo(43.6953, 7.2654, "2025-06-12T08:00:00Z"),
      photo(43.6975, 7.2769, "2025-06-12T22:00:00Z"), // same day, ~14h apart
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(1);
  });

  it("splits into a new step once far enough away", () => {
    const media = [
      photo(48.8584, 2.2945, "2025-06-10T09:00:00Z"), // Paris
      photo(45.7626, 4.8272, "2025-06-11T12:00:00Z"), // Lyon, ~390km away
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(2);
  });

  it("splits on a new day at a nearby-but-different place", () => {
    // ~5km apart (over the SAME_PLACE threshold) and a day later.
    const media = [
      photo(48.8584, 2.2945, "2025-06-10T09:00:00Z"),
      photo(48.9, 2.35, "2025-06-11T18:00:00Z"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(2);
  });

  it("attaches GPS-less media to the nearest step in time", () => {
    const media: TaggedMedia[] = [
      photo(48.8584, 2.2945, "2025-06-10T09:00:00Z"),
      {
        sourcePath: "/fake/screenshot.jpg",
        kind: "photo",
        takenAt: new Date("2025-06-10T10:00:00Z"),
      },
      photo(45.7626, 4.8272, "2025-06-11T12:00:00Z"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.media).toHaveLength(2);
  });

  it("returns nothing for empty input", () => {
    expect(groupIntoSteps([])).toEqual([]);
  });
});

describe("inferTransportMode", () => {
  it("calls a long fast leg a flight", () => {
    const mode = inferTransportMode(
      { lat: 48.8566, lng: 2.3522 }, // Paris
      { lat: 41.9028, lng: 12.4964 }, // Rome, ~1100km
      new Date("2025-06-10T09:00:00Z"),
      new Date("2025-06-10T11:00:00Z"), // 2 hours
    );
    expect(mode).toBe("FLIGHT");
  });

  it("calls a long slow leg ground transport, not a flight", () => {
    const mode = inferTransportMode(
      { lat: 48.8566, lng: 2.3522 },
      { lat: 41.9028, lng: 12.4964 },
      new Date("2025-06-10T09:00:00Z"),
      new Date("2025-06-11T09:00:00Z"), // 24 hours -> too slow to be a flight
    );
    expect(mode).toBe("CAR");
  });

  it("calls a very short hop on foot", () => {
    const mode = inferTransportMode(
      { lat: 48.8566, lng: 2.3522 },
      { lat: 48.857, lng: 2.353 },
      new Date("2025-06-10T09:00:00Z"),
      new Date("2025-06-10T09:10:00Z"),
    );
    expect(mode).toBe("FOOT");
  });

  it("still calls a real long-haul flight a flight, even with a full day of unphotographed slack at both ends", () => {
    // Real regression: Maldives -> Singapore, ~3,390km. The gap between the
    // last photo before departing and the first photo after arriving was
    // ~28.5 hours (nothing photo-worthy happened at the airport, in transit,
    // or checking into the next hotel) — ~119km/h, which used to fall below
    // the old 150km/h bar and get misclassified as CAR despite there being
    // no possible ground/sea route between the two.
    const mode = inferTransportMode(
      { lat: 1.8172, lng: 73.405 },
      { lat: 1.309, lng: 103.9036 },
      new Date("2026-08-23T09:01:52Z"),
      new Date("2026-08-24T13:30:43Z"),
    );
    expect(mode).toBe("FLIGHT");
  });
});

describe("groupIntoSteps with no GPS at all", () => {
  it("produces no steps, since there's nowhere to place them", () => {
    const media = [noGpsPhoto("2025-06-10T09:00:00Z")];
    expect(groupIntoSteps(media)).toHaveLength(0);
  });
});

describe("groupIntoSteps with a mix of located and no-GPS photos", () => {
  it("attaches a stray no-GPS photo to a real step in the same day", () => {
    const media = [
      photo(48.8566, 2.3522, "2025-06-10T09:00:00Z"),
      noGpsPhoto("2025-06-10T13:00:00Z"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.media).toHaveLength(2);
  });

  it("drops a no-GPS photo on a day with no located step to attach to", () => {
    const media = [
      photo(1.82, 73.41, "2025-06-10T09:00:00Z", "day1-located"),
      noGpsPhoto("2025-06-12T09:00:00Z", "day3-nogps"),
    ];
    const steps = groupIntoSteps(media);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.media).toHaveLength(1);
  });
});
