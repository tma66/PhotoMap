// Public visitors come through the Tailscale Funnel link, addressed to the
// Mac's `*.ts.net` name (Funnel keeps the Host header); home visitors use
// `pikapro.local` or an IP. Public visitors see only public trips (trip.json
// "public": true) and can't change anything — enforced in src/proxy.ts.

export function isPublicHost(host: string | null | undefined): boolean {
  const name = host?.split(":")[0]?.toLowerCase() ?? "";
  return name.endsWith(".ts.net");
}

// App shell paths a public visitor may load as is: Next's own files, the
// /public page, and public/ folders (MapLibre worker, pet cartoons).
const OPEN_SECTIONS = new Set(["_next", "public", "maplibre", "pet"]);
// A single-segment file — icons, the manifest, the profile photo.
const ROOT_FILE = /^\/[\w.-]+\.(png|svg|ico|webmanifest)$/;

/** What a public visitor's request to `pathname` needs: refused outright,
 * the public-only home page, a check that the trip folder `slug` is public,
 * or nothing (app shell files). Anything not listed is refused, so an odd
 * spelling of a trip path (`//m/…`, `/%6D/…`) can't skip the trip check. */
export type PublicRoute =
  | { kind: "forbidden" }
  | { kind: "home" }
  | { kind: "trip"; slug: string }
  | { kind: "open" };

export function publicRoute(pathname: string): PublicRoute {
  if (pathname === "/") return { kind: "home" };
  const [, section, slug] = pathname.split("/");
  if (section === "m" || section === "media") {
    try {
      return { kind: "trip", slug: decodeURIComponent(slug ?? "") };
    } catch {
      return { kind: "forbidden" };
    }
  }
  if (OPEN_SECTIONS.has(section ?? "") || ROOT_FILE.test(pathname)) {
    return { kind: "open" };
  }
  return { kind: "forbidden" };
}
