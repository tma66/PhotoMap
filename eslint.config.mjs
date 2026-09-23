import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "data/**",
    "assets/**",
    "public/maplibre/**", // vendored copy, not our source — see scripts/copy-maplibre-worker.mjs
  ]),
]);
