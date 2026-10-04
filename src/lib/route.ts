// Builds the GeoJSON the map draws for a trip: a dashed great-circle line
// from each step's pin to the next one in a different city. Pin to pin (not
// along the photos' GPS trail) so the line always meets the pins, including
// ones moved by hand.
import { greatCircleArc } from "./geo";
import { isHeaven } from "./heaven";

export interface RouteStep {
  id: string;
  lat: number;
  lng: number;
  transportMode: string;
  /** Steps in the same city get no line between them — see cityNameFor in
   * src/ingest/geocode.ts. */
  cityName: string;
}

interface RouteLeg {
  coordinates: [number, number][]; // [lng, lat], GeoJSON order
}

export function buildRouteLegs(steps: RouteStep[]): RouteLeg[] {
  const legs: RouteLeg[] = [];

  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    if (from.cityName === to.cityName) continue;
    if (isHeaven(from) || isHeaven(to)) continue; // no line up to heaven
    // Flights get a smoother arc; a ground leg is short enough for fewer points.
    const points = to.transportMode === "FLIGHT" ? 48 : 24;
    const coords = greatCircleArc(from, to, points).map(
      (p) => [p.lng, p.lat] as [number, number],
    );
    legs.push({ coordinates: coords });
  }

  return legs;
}

export function legsToGeoJSON(
  legs: RouteLeg[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: legs.map((leg) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: leg.coordinates },
    })),
  };
}
