// Public visitors come through the Tailscale Funnel link, addressed to the
// Mac's `*.ts.net` name (Funnel keeps the Host header); home visitors use
// `pikapro.local` or an IP. Public visitors see only public trips (trip.json
// "public": true) and can't change anything — enforced in src/proxy.ts.

export function isPublicHost(host: string | null | undefined): boolean {
  const name = host?.split(":")[0]?.toLowerCase() ?? "";
  return name.endsWith(".ts.net");
}

/** What a public visitor's request to `pathname` needs: refused outright,
 * the public-only home page, a check that the trip folder `slug` is public,
 * or nothing (app shell files: /_next, icons, manifest). */
export type PublicRoute =
  | { kind: "forbidden" }
  | { kind: "home" }
  | { kind: "trip"; slug: string }
  | { kind: "open" };

export function publicRoute(pathname: string): PublicRoute {
  if (pathname === "/") return { kind: "home" };
  const [, section, slug] = pathname.split("/");
  if (section === "api") return { kind: "forbidden" };
  if (section === "m" || section === "media") {
    try {
      return { kind: "trip", slug: decodeURIComponent(slug ?? "") };
    } catch {
      return { kind: "forbidden" };
    }
  }
  return { kind: "open" };
}
