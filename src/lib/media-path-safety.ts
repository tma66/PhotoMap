// Shared by the media route handler and its tests. Kept as pure string
// validation (no filesystem access) so it's easy to unit test directly.

// <20 hex char content hash>-(thumb|display).jpg — content-addressed, so a
// cache-busting query string is never needed and the response can be
// cached "immutable".
const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;
const SAFE_FILE = /^[a-f0-9]{20}-(thumb|display)\.jpg$/;

/** Rejects path traversal, absolute paths, and anything not matching the
 * expected content-addressed filename shape. */
export function isSafeMediaRequest(slug: string, file: string): boolean {
  return SAFE_SLUG.test(slug) && SAFE_FILE.test(file);
}
