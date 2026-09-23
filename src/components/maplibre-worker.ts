import { setWorkerUrl } from "maplibre-gl";

// See scripts/copy-maplibre-worker.mjs (run via the prebuild/predev npm
// hooks) — Turbopack doesn't emit the worker's sibling file correctly when
// bundled the normal way, so both are served as static files instead.
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
