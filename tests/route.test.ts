import { describe, expect, it } from "vitest";
import { buildRouteLegs, curvedArc, type RouteStep } from "@/lib/route";

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

  it("draws each city-to-city trip once per direction", () => {
    const la = step({ id: "a", lat: 34.05, lng: -118.24, cityName: "LA" });
    const sf = step({ id: "b", lat: 37.77, lng: -122.42, cityName: "SF" });
    const legs = buildRouteLegs([la, sf, la, sf, la]);
    expect(legs).toHaveLength(2); // LA→SF and SF→LA
    expect(legs[0]!.coordinates.at(0)).toEqual(closeCoord(-118.24, 34.05));
    expect(legs[1]!.coordinates.at(0)).toEqual(closeCoord(-122.42, 37.77));
  });
});

describe("curvedArc", () => {
  const la = { lat: 34.05, lng: -118.24 };
  const sf = { lat: 37.77, lng: -122.42 };

  it("still starts and ends at the pins", () => {
    const arc = curvedArc(la, sf, 24);
    expect(arc.at(0)).toEqual({
      lat: expect.closeTo(la.lat),
      lng: expect.closeTo(la.lng),
    });
    expect(arc.at(-1)).toEqual({
      lat: expect.closeTo(sf.lat),
      lng: expect.closeTo(sf.lng),
    });
  });

  it("bows the way there and the way back to opposite sides", () => {
    // Which side of the straight LA–SF line a point is on.
    const side = (p: { lat: number; lng: number }) =>
      Math.sign(
        (sf.lng - la.lng) * (p.lat - la.lat) -
          (sf.lat - la.lat) * (p.lng - la.lng),
      );
    const there = curvedArc(la, sf, 25)[12]!;
    const back = curvedArc(sf, la, 25)[12]!;
    expect(side(there)).not.toBe(0);
    expect(side(back)).toBe(-side(there));
  });
});
