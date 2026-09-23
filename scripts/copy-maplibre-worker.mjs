// Turbopack (Next's default bundler) doesn't emit maplibre-gl's worker
// correctly — see docs/setup.md "Map troubleshooting". Copying both worker
// files into public/ and pointing setWorkerUrl() at them (see
// src/components/maplibre-worker.ts) works around it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dist = path.join(
  path.dirname(
    createRequire(import.meta.url).resolve("maplibre-gl/package.json"),
  ),
  "dist",
);
const dest = path.join(process.cwd(), "public", "maplibre");

mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(dest, file));
}
console.log("copied maplibre-gl worker files to public/maplibre/");
