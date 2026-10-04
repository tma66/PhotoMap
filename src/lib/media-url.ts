export function mediaUrl(
  slug: string,
  hash: string,
  variant: "thumb" | "pin" | "card" | "display" | "video",
): string {
  const ext = variant === "video" ? "mp4" : "jpg";
  return `/media/${slug}/${hash}-${variant}.${ext}`;
}
