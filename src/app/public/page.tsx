import HomeView from "@/components/HomeView";
import { loadHomeData } from "@/lib/home-data";

/** Public visitors' home page: src/proxy.ts rewrites their "/" here. */
export default async function PublicHomePage() {
  return <HomeView data={await loadHomeData(true)} />;
}
