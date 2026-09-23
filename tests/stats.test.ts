import { describe, expect, it } from "vitest";
import {
  continentsVisited,
  percentOfWorldSeen,
  tripDistanceKm,
  tripDurationDays,
  uniqueCountryCodes,
} from "@/lib/stats";

describe("tripDistanceKm", () => {
  it("sums leg distances across steps", () => {
    const steps = [
      { lat: 48.8566, lng: 2.3522, countryCode: "FR" }, // Paris
      { lat: 45.764, lng: 4.8357, countryCode: "FR" }, // Lyon
      { lat: 43.7102, lng: 7.262, countryCode: "FR" }, // Nice
    ];
    const km = tripDistanceKm(steps);
    expect(km).toBeGreaterThan(600);
    expect(km).toBeLessThan(780);
  });

  it("is zero for a single step", () => {
    expect(tripDistanceKm([{ lat: 0, lng: 0, countryCode: "XX" }])).toBe(0);
  });
});

describe("tripDurationDays", () => {
  it("counts a same-day trip as 1 day", () => {
    const d = new Date("2025-06-10T09:00:00Z");
    expect(tripDurationDays(d, d)).toBe(1);
  });

  it("counts inclusive of both endpoints", () => {
    expect(
      tripDurationDays(new Date("2025-06-10"), new Date("2025-06-12")),
    ).toBe(3);
  });
});

describe("uniqueCountryCodes", () => {
  it("dedupes and drops empty codes", () => {
    const steps = [
      { lat: 0, lng: 0, countryCode: "FR" },
      { lat: 0, lng: 0, countryCode: "FR" },
      { lat: 0, lng: 0, countryCode: "" },
      { lat: 0, lng: 0, countryCode: "CH" },
    ];
    expect(uniqueCountryCodes(steps).sort()).toEqual(["CH", "FR"]);
  });
});

describe("continentsVisited", () => {
  it("maps ISO codes to their region via world-countries", () => {
    const continents = continentsVisited(["FR", "JP", "US"]);
    expect(continents).toContain("Europe");
    expect(continents).toContain("Asia");
    expect(continents).toContain("Americas");
  });

  it("ignores unknown codes", () => {
    expect(continentsVisited(["ZZ"])).toEqual([]);
  });
});

describe("percentOfWorldSeen", () => {
  it("is 0 for no countries", () => {
    expect(percentOfWorldSeen([])).toBe(0);
  });

  it("increases as more (or bigger) countries are added", () => {
    const small = percentOfWorldSeen(["MC"]); // Monaco, tiny
    const big = percentOfWorldSeen(["RU"]); // Russia, huge
    expect(big).toBeGreaterThan(small);
  });
});
