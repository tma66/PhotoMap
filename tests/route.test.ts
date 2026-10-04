import { describe, expect, it } from "vitest";
import { buildRouteLegs, type RouteStep } from "@/lib/route";

// greatCircleArc round-trips through radians/trig, so its first/last point
// matches the input up to floating-point noise, not exactly.
function closeCoord(lng: number, lat: number) {
  return [expect.closeTo(lng), expect.closeTo(lat)];
}

function step(overrides: Partial<RouteStep>): RouteStep {
  return {
    id: "s",
    lat: 0,
    lng: 0,
    transportMode: "FOOT",
    cityName: "Nowhere",
    ...overrides,
  };
}

describe("buildRouteLegs", () => {
  it("draws no leg between consecutive steps in the same city", () => {
    const steps = [
      step({ id: "a", lat: 34.06, lng: -118.44, cityName: "Los Angeles" }),
      step({ id: "b", lat: 34.02, lng: -118.39, cityName: "Los Angeles" }),
    ];
    expect(buildRouteLegs(steps)).toEqual([]);
  });

  it("draws a leg pin to pin when the city changes", () => {
    const steps = [
      step({ id: "a", lat: 1.28, lng: 103.85, cityName: "Singapore" }),
      step({ id: "b", lat: -8.34, lng: 115.09, cityName: "Denpasar" }),
    ];
    const legs = buildRouteLegs(steps);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.coordinates.at(0)).toEqual(closeCoord(103.85, 1.28));
    expect(legs[0]!.coordinates.at(-1)).toEqual(closeCoord(115.09, -8.34));
  });

  it("skips only the same-city pair in a longer route", () => {
    const steps = [
      step({ id: "a", lat: 1.28, lng: 103.85, cityName: "Singapore" }),
      step({ id: "b", lat: 1.3, lng: 103.9, cityName: "Singapore" }),
      step({ id: "c", lat: -8.34, lng: 115.09, cityName: "Denpasar" }),
    ];
    const legs = buildRouteLegs(steps);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.coordinates.at(0)).toEqual(closeCoord(103.9, 1.3));
    expect(legs[0]!.coordinates.at(-1)).toEqual(closeCoord(115.09, -8.34));
  });
});
