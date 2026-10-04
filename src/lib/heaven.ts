// A step at exactly 0,0 is a pet's last stop after it passed away: it's
// shown in a paradise above the globe instead of as a pin on the map
// (see src/components/HeavenScene.tsx), and left out of distances, cities
// and countries.

export function isHeaven(p: { lat: number; lng: number }): boolean {
  return p.lat === 0 && p.lng === 0;
}

/** trip.json's locationName/cityName for a photo at 0,0. */
export const HEAVEN_PLACE = "Paradise";

/** The step's name, e.g. "Momo Paradise". */
export function heavenName(tripTitle: string): string {
  return `${tripTitle} ${HEAVEN_PLACE}`;
}

export const HEAVEN_BADGE = "🐾";
export const HEAVEN_SUBTITLE = "Tammy's Heart";
/** The finished card of a trip that ends in heaven, dated today. */
export const HEAVEN_END_LABEL = "Trip never forgotten";
