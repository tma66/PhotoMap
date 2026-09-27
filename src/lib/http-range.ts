// Parses a single-range `Range` request header (RFC 7233 §2.1). Kept as a
// pure function (no filesystem access) so it's easy to unit test directly —
// used by the media route handler.

export interface ByteRange {
  start: number;
  end: number;
}

/** Returns the requested byte range, or undefined if the header is absent,
 * malformed, multi-range, or out of bounds for `size`. */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return undefined;

  const [, startStr, endStr] = match;
  // "bytes=-500" (empty start) is a suffix range: the last 500 bytes — not
  // "start at byte 0", which parsing both groups the same way would give.
  const { start, end } =
    startStr === ""
      ? { start: Math.max(0, size - parseInt(endStr!, 10)), end: size - 1 }
      : {
          start: parseInt(startStr!, 10),
          end: endStr ? parseInt(endStr, 10) : size - 1,
        };

  if (!(start < size && end < size && start <= end)) return undefined;
  return { start, end };
}
