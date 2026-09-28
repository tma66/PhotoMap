// Shared secret between the ingest script and the running site, so only
// ingest (same machine, same checkout) can tell the site to drop its cached
// pages — see src/app/api/revalidate/route.ts. Lives under data/ (gitignored),
// created by ingest on first use.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const REVALIDATE_TOKEN_PATH = resolve(
  /* turbopackIgnore: true */ "./data/revalidate-token",
);

export async function readRevalidateToken(): Promise<string | null> {
  return readFile(REVALIDATE_TOKEN_PATH, "utf8")
    .then((t) => t.trim() || null)
    .catch(() => null);
}

export async function ensureRevalidateToken(): Promise<string> {
  const existing = await readRevalidateToken();
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(REVALIDATE_TOKEN_PATH), { recursive: true });
  await writeFile(REVALIDATE_TOKEN_PATH, token, { mode: 0o600 });
  return token;
}
