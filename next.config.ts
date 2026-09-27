import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mobile-only site with no external image hosts — media is served by our
  // own route (src/app/media/[slug]/[file]/route.ts) from data/cache/.
  images: {
    unoptimized: true,
  },
  // Lets `npm run dev` be reached from another device on the LAN by its
  // Bonjour hostname (e.g. testing on a phone before switching to
  // `next start`, which doesn't have this restriction at all).
  allowedDevOrigins: ["pikapro.local"],
  // The route dev-indicator (bottom-left) is a Next.js dev-only tool, not
  // part of this site's UI — hidden since it reads as a stray settings icon.
  devIndicators: false,
};

export default nextConfig;
