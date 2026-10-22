import HomeView from "@/components/HomeView";
import { loadHomeData } from "@/lib/home-data";

export default async function HomePage() {
  return <HomeView data={await loadHomeData(false)} />;
}
