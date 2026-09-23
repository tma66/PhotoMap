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
    type: "IMAGE",
    takenAt: new Date(takenAt),
    lat,
    lng,
    caption,
    width: 100,
    height: 100,
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

  it("does not split a multi-day stay at the same spot", () => {
    // Regression test: an earlier version split any >20h gap into a new
    // step even at an unchanged location (two Nice photos a day apart).
    const media = [
      photo(43.6953, 7.2654, "2025-06-12T18:00:00Z"),
      photo(43.6975, 7.2769, "2025-06-13T16:30:00Z"), // ~22.5h later, ~1km away
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
        type: "IMAGE",
        takenAt: new Date("2025-06-10T10:00:00Z"),
        width: 100,
        height: 100,
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
});
