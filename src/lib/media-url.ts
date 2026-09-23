export function mediaUrl(
  slug: string,
  hash: string,
  variant: "thumb" | "display",
): string {
  return `/media/${slug}/${hash}-${variant}.jpg`;
}
