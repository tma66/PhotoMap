import { describe, expect, it } from "vitest";
import { isPublicHost, publicRoute } from "@/lib/public-visitor";

describe("isPublicHost", () => {
  it("treats the Funnel name as public, with or without a port", () => {
    expect(isPublicHost("pikapro.tail1234.ts.net")).toBe(true);
    expect(isPublicHost("PIKAPRO.tail1234.TS.NET:443")).toBe(true);
  });

  it("treats home Wi-Fi addresses as home", () => {
    expect(isPublicHost("pikapro.local:3000")).toBe(false);
    expect(isPublicHost("localhost:3000")).toBe(false);
    expect(isPublicHost("192.168.1.20:3000")).toBe(false);
    expect(isPublicHost(null)).toBe(false);
  });

  it("isn't fooled by a name merely containing ts.net", () => {
    expect(isPublicHost("ts.net.evil.com")).toBe(false);
  });
});

describe("publicRoute", () => {
  it("swaps the home page", () => {
    expect(publicRoute("/")).toEqual({ kind: "home" });
  });

  it("refuses every API route", () => {
    for (const p of [
      "/api/step-location",
      "/api/revalidate",
      "/api/client-log",
    ]) {
      expect(publicRoute(p)).toEqual({ kind: "forbidden" });
    }
  });

  it("checks the trip folder for trip pages and media", () => {
    expect(publicRoute("/m/Japan")).toEqual({ kind: "trip", slug: "Japan" });
    expect(publicRoute("/m/Japan/2/placeholders")).toEqual({
      kind: "trip",
      slug: "Japan",
    });
    expect(publicRoute("/media/Hong-Kong/abc-card.jpg")).toEqual({
      kind: "trip",
      slug: "Hong-Kong",
    });
    expect(publicRoute("/m/The%20Changs")).toEqual({
      kind: "trip",
      slug: "The Changs",
    });
    expect(publicRoute("/m")).toEqual({ kind: "trip", slug: "" });
  });

  it("refuses an undecodable folder name", () => {
    expect(publicRoute("/m/%E0%A4%A")).toEqual({ kind: "forbidden" });
  });

  it("leaves app shell files alone", () => {
    expect(publicRoute("/_next/static/chunk.js")).toEqual({ kind: "open" });
    expect(publicRoute("/manifest.webmanifest")).toEqual({ kind: "open" });
    for (const p of [
      "/public",
      "/icon.png",
      "/apple-icon.png",
      "/icon-192.png",
      "/pika-profile.png",
      "/maplibre/maplibre-gl-worker.mjs",
      "/pet/run.svg",
    ]) {
      expect(publicRoute(p)).toEqual({ kind: "open" });
    }
  });

  it("refuses any other path, including odd spellings of trip paths", () => {
    for (const p of [
      "//m/Korea/1",
      "/%6D/Korea/1",
      "/%6d/Korea/1",
      "/M/Korea/1",
      "/robots.txt",
      "/.well-known/security.txt",
      "/unknown/page",
      "/a/b.png",
    ]) {
      expect(publicRoute(p)).toEqual({ kind: "forbidden" });
    }
  });
});
