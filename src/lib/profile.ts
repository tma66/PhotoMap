import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Profile {
  name: string;
  bio: string;
  avatar: string | null;
}

const DEFAULT_PROFILE: Profile = {
  name: "Traveler",
  bio: "",
  avatar: null,
};

/** Optional assets/profile.json override — see docs/setup.md. */
export async function loadProfile(): Promise<Profile> {
  const assetsDir = process.env.ASSETS_DIR ?? "./assets";
  try {
    const raw = await readFile(join(assetsDir, "profile.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return DEFAULT_PROFILE;
  }
}
