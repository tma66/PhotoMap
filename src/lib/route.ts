// Builds the GeoJSON the map draws for a trip: a gently curved line from
// each step's pin to the next one in a different city. Pin to pin (not
// along the photos' GPS trail) so the line always meets the pins, including
// ones moved by hand.
import { greatCircleArc, type LatLng } from "./geo";
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

// How far a leg bows out at its middle, as a fraction of its length.
const BEND = 0.12;

/** The great circle from `a` to `b`, bowed out to the right of the
 * direction of travel — so a trip there and the one back curve to opposite
 * sides instead of drawing over each other. */
export function curvedArc(a: LatLng, b: LatLng, points: number): LatLng[] {
  const arc = greatCircleArc(a, b, points);
  // Sideways offsets in a flat lat/lng frame around the leg's middle:
  // close enough at the scale of a bend.
  const cosLat = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dLng = ((((b.lng - a.lng) % 360) + 540) % 360) - 180;
  const dx = dLng * cosLat;
  const dy = b.lat - a.lat;
  return arc.map((p, i) => {
    const bow = Math.sin((Math.PI * i) / (arc.length - 1)) * BEND;
    // (dy, -dx) is the travel direction turned a quarter to the right.
    return { lat: p.lat - dx * bow, lng: p.lng + (dy * bow) / cosLat };
  });
}

export function buildRouteLegs(steps: RouteStep[]): RouteLeg[] {
  const legs: RouteLeg[] = [];
  // Each city-to-city trip is drawn once per direction, however many times
  // it was made.
  const drawn = new Set<string>();

  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    if (from.cityName === to.cityName) continue;
    if (isHeaven(from) || isHeaven(to)) continue; // no line up to heaven
    const key = `${from.cityName}\u2192${to.cityName}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    // Flights get a smoother arc; a ground leg is short enough for fewer points.
    const points = to.transportMode === "FLIGHT" ? 48 : 24;
    const coords = curvedArc(from, to, points).map(
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
