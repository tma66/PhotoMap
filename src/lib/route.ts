// Builds the GeoJSON the map draws for a trip: a dashed great-circle arc for
// each flight leg, and the dense actual-photos trail for ground legs.
import { greatCircleArc } from "./geo";

export interface RouteStep {
  id: string;
  lat: number;
  lng: number;
  arrivedAt: Date;
  transportMode: string;
  locationName: string;
}

export interface RouteTrackPoint {
  t: Date;
  lat: number;
  lng: number;
}

interface RouteLeg {
  coordinates: [number, number][]; // [lng, lat], GeoJSON order
}

export function buildRouteLegs(
  steps: RouteStep[],
  trackPoints: RouteTrackPoint[],
): RouteLeg[] {
  const legs: RouteLeg[] = [];

  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    if (from.locationName === to.locationName) continue; // same city, no line
    const isFlight = to.transportMode === "FLIGHT";

    let coords: [number, number][];
    if (isFlight) {
      coords = greatCircleArc(from, to, 48).map(
        (p) => [p.lng, p.lat] as [number, number],
      );
    } else {
      const between = trackPoints.filter(
        (p) => p.t >= from.arrivedAt && p.t <= to.arrivedAt,
      );
      coords =
        between.length >= 2
          ? between.map((p) => [p.lng, p.lat] as [number, number])
          : greatCircleArc(from, to, 24).map(
              (p) => [p.lng, p.lat] as [number, number],
            );
    }

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
