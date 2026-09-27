import { cpus } from "node:os";

const DEFAULT_CONCURRENCY = Math.max(2, cpus().length);

/**
 * Runs `fn` over `items` with at most `limit` in flight at once (default:
 * roughly one per CPU core). A plain `Promise.all` would fire every call at
 * once — for a trip with a few hundred photos, that's a few hundred
 * concurrent `sips`/sharp processes fighting over the same handful of cores.
 * Results come back in the same order as `items`, regardless of which
 * finishes first.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
