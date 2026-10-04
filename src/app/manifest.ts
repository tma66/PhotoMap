import type { MetadataRoute } from "next";

/** Lets "Add to Home Screen" install the site as a full-screen app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PhotoMap",
    short_name: "PhotoMap",
    description: "Follow the trip.",
    start_url: "/",
    display: "standalone",
    background_color: "#00293d",
    theme_color: "#00293d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
