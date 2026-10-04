// Distance and route math shared by ingestion and the map UI.

const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Total length of a sequence of points, in kilometres. */
export function pathLengthKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Points along the great-circle arc between two coordinates, for drawing
 * curved flight paths (slerp in radians, converted back to lat/lng).
 */
export function greatCircleArc(a: LatLng, b: LatLng, steps = 64): LatLng[] {
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const lng2 = toRad(b.lng);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
      ),
    );

  if (d === 0) return [a, b];

  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y =
      A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    let lng = Math.atan2(y, x) * (180 / Math.PI);

    // atan2 wraps longitude to (-180, 180], so a path that actually crosses
    // the antimeridian (e.g. California -> Singapore, whose shortest route
    // runs west across the Pacific) jumps discontinuously between two
    // consecutive points (e.g. +179.9 to -179.9). A flat map doesn't know to
    // bridge that gap and instead draws a straight line across the entire
    // visible world. Unwrap relative to the previous point so the sequence
    // stays continuous — MapLibre's default renderWorldCopies then draws it
    // crossing into the adjacent world copy instead of snapping back.
    const prevLng = points.at(-1)?.lng;
    if (prevLng != null) {
      while (lng - prevLng > 180) lng -= 360;
      while (lng - prevLng < -180) lng += 360;
    }

    points.push({ lat: (lat * 180) / Math.PI, lng });
  }
  return points;
}
