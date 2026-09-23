import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mobile-only site with no external image hosts — media is served by our
  // own route (src/app/media/[slug]/[file]/route.ts) from data/cache/.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
