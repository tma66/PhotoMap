// Builds the GeoJSON the map draws for a trip: a dashed great-circle arc for
// each flight leg, and the dense actual-photos trail for ground legs.
import { greatCircleArc, type LatLng } from "./geo";

export interface RouteStep {
  id: string;
  lat: number;
  lng: number;
  arrivedAt: Date;
  transportMode: string;
}

export interface RouteTrackPoint {
  t: Date;
  lat: number;
  lng: number;
}

export interface RouteLeg {
  fromStepId: string;
  toStepId: string;
  isFlight: boolean;
  coordinates: [number, number][]; // [lng, lat], GeoJSON order
  midpoint: LatLng;
}

export function buildRouteLegs(
  steps: RouteStep[],
  trackPoints: RouteTrackPoint[],
): RouteLeg[] {
  const legs: RouteLeg[] = [];

  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
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
          : [
              [from.lng, from.lat],
              [to.lng, to.lat],
            ];
    }

    const mid = coords[Math.floor(coords.length / 2)]!;
    legs.push({
      fromStepId: from.id,
      toStepId: to.id,
      isFlight,
      coordinates: coords,
      midpoint: { lat: mid[1], lng: mid[0] },
    });
  }

  return legs;
}

export function legsToGeoJSON(
  legs: RouteLeg[],
): GeoJSON.FeatureCollection<GeoJSON.LineString, { isFlight: boolean }> {
  return {
    type: "FeatureCollection",
    features: legs.map((leg) => ({
      type: "Feature",
      properties: { isFlight: leg.isFlight },
      geometry: { type: "LineString", coordinates: leg.coordinates },
    })),
  };
}
