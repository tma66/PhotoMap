// Which map tiles a flight's landing on a point will need, so TripMap can
// fetch them into the browser cache before the flight starts.
import type { LatLng } from "./geo";

export interface TileXYZ {
  z: number;
  x: number;
  y: number;
}

// The cols×rows block of web-mercator tiles centred on `to` at each zoom
// from zMin to zMax (near the ground the view is centred on `to`). Columns
// wrap at the antimeridian; rows past the poles are dropped.
export function landingTiles(
  to: LatLng,
  zMin: number,
  zMax: number,
  cols = 2,
  rows = 2,
): TileXYZ[] {
  const lat = (to.lat * Math.PI) / 180;
  const fy = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
  const tiles: TileXYZ[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const n = 2 ** z;
    const x0 = Math.round(((to.lng + 180) / 360) * n - cols / 2);
    const y0 = Math.round(fy * n - rows / 2);
    for (let x = x0; x < x0 + cols; x++) {
      for (let y = y0; y < y0 + rows; y++) {
        if (y >= 0 && y < n) tiles.push({ z, x: (x + n) % n, y });
      }
    }
  }
  return tiles;
}

// Tiles across `px` screen pixels, whatever the offset, for tiles drawn at
// least `tilePx` wide.
export function tilesAcross(px: number, tilePx: number): number {
  return Math.max(2, Math.ceil(px / tilePx) + 1);
}

export function tileUrl(template: string, { z, x, y }: TileXYZ): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
