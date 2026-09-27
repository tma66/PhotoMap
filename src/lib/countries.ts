// Thin wrapper around the `world-countries` reference dataset (ISO codes,
// names, region, land area) — offline, no network calls, no API key.
import worldCountries from "world-countries";

interface CountryInfo {
  cca2: string;
  cca3: string;
  name: string;
  subregion: string;
  areaKm2: number;
}

const BY_CCA2 = new Map<string, CountryInfo>();
const BY_CCA3 = new Map<string, CountryInfo>();

for (const c of worldCountries) {
  const info: CountryInfo = {
    cca2: c.cca2,
    cca3: c.cca3,
    name: c.name.common,
    subregion: c.subregion,
    areaKm2: c.area,
  };
  BY_CCA2.set(c.cca2, info);
  BY_CCA3.set(c.cca3, info);
}

export function countryByAlpha2(cca2: string): CountryInfo | undefined {
  return BY_CCA2.get(cca2.toUpperCase());
}

export function alpha3ToAlpha2(cca3: string): string | undefined {
  return BY_CCA3.get(cca3.toUpperCase())?.cca2;
}
