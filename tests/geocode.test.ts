import { describe, expect, it } from "vitest";
import { countryCodeForPoint, nearestPlaceName } from "../src/ingest/geocode";

describe("countryCodeForPoint", () => {
  it("resolves a point clearly inside a country's land polygon", () => {
    expect(countryCodeForPoint({ lat: 48.8566, lng: 2.3522 })).toBe("FR");
  });

  it("falls back to the nearest named place's country for small islands/atolls missing from the land dataset", () => {
    // Laamu Atoll, Maldives — real regression: the bundled 10km-resolution
    // land polygons don't include this atoll, so point-in-polygon alone
    // reports open ocean even though it's inhabited land.
    expect(countryCodeForPoint({ lat: 1.8173, lng: 73.4049 })).toBe("MV");
  });

  it("still reports undefined far from any named place", () => {
    expect(countryCodeForPoint({ lat: 0, lng: -140 })).toBeUndefined();
  });

  it("resolves coastal/reclaimed land the 10km polygon clips off, without jumping across a strait", () => {
    // Singapore Changi Airport — real regression: this point sits ~2.2km
    // outside the bundled Singapore land polygon (built substantially on
    // reclaimed land), so exact point-in-polygon reported open ocean and
    // fell through to the nearest-named-place fallback, which is a town in
    // Malaysia (Kampung Pasir Gudang Baru, across the strait) since it beat
    // "Singapore"'s single dataset entry on raw distance.
    expect(
      countryCodeForPoint({ lat: 1.362389044196566, lng: 103.99012395156541 }),
    ).toBe("SG");
  });
});

describe("nearestPlaceName", () => {
  it("finds a named place near a country-less point via global fallback", () => {
    expect(nearestPlaceName({ lat: 1.8173, lng: 73.4049 })).toBe("Fonadhoo");
  });
});
