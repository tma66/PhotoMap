export function mediaUrl(
  slug: string,
  hash: string,
  variant: "thumb" | "pin" | "card" | "display" | "hevc",
): string {
  const ext = variant === "hevc" ? "mp4" : "avif";
  return `/media/${slug}/${hash}-${variant}.${ext}`;
}
