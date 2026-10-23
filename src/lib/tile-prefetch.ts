// Which map tiles a flight's landing on a point will need, so TripMap can
// fetch them into the browser cache before the flight starts.
import type { LatLng } from "./geo";

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

// The 2×2 web-mercator tiles nearest `to` at each zoom from zMin to zMax:
// near the ground the view is centred on `to`, and a phone screen spans
// about one tile each way. Columns wrap at the antimeridian; rows past the
// poles are dropped.
export function landingTiles(
  to: LatLng,
  zMin: number,
  zMax: number,
): TileXYZ[] {
  const lat = (to.lat * Math.PI) / 180;
  const fy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
  const tiles: TileXYZ[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const n = 2 ** z;
    const x0 = Math.round(((to.lng + 180) / 360) * n) - 1;
    const y0 = Math.round(fy * n) - 1;
    for (const x of [x0, x0 + 1]) {
      for (const y of [y0, y0 + 1]) {
        if (y >= 0 && y < n) tiles.push({ z, x: (x + n) % n, y });
      }
    }
  }
  return tiles;
}

export function tileUrl(template: string, { z, x, y }: TileXYZ): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
