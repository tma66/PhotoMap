// Historical weather for a step's date/place, from Open-Meteo's free
// archive API (no key required). Only coordinates + date are sent — no
// personal data. Failures are non-fatal: a step just shows no weather tag.
interface WeatherResult {
  tempF: number;
  code: number;
}

// The day's weather is what it was like while out and about, not overnight.
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 18;
// Fewer wet (or foggy) daytime hours than this is a passing shower, not the day.
const MIN_HOURS = 3;

const isWet = (code: number) => code >= 51;
const isFog = (code: number) => code === 45 || code === 48;

function mostCommon(codes: number[]): number {
  const counts = new Map<number, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Ties go to the more severe (higher) code.
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
}

/**
 * One temperature and WMO code for a day, from its 24 hourly readings
 * (index = local hour): the daytime high, and rain/snow or fog only if it
 * lasted `MIN_HOURS` of the daytime — otherwise the average sky cover
 * (codes 0–3 run clear to overcast). Open-Meteo's own daily code is the
 * day's most severe hour, which turns a 2am shower into a rainy day.
 */
export function summarizeDaytime(
  temps: (number | null)[],
  codes: (number | null)[],
): WeatherResult | undefined {
  const daytime = <T>(hourly: (T | null)[]) =>
    hourly
      .slice(DAY_START_HOUR, DAY_END_HOUR + 1)
      .filter((v): v is T => v != null);
  const dayTemps = daytime(temps);
  const dayCodes = daytime(codes);
  if (dayTemps.length === 0 || dayCodes.length === 0) return undefined;

  const tempF = Math.round(Math.max(...dayTemps));
  const wet = dayCodes.filter(isWet);
  if (wet.length >= MIN_HOURS) return { tempF, code: mostCommon(wet) };
  const fog = dayCodes.filter(isFog);
  if (fog.length >= MIN_HOURS) return { tempF, code: mostCommon(fog) };
  const sky = dayCodes.filter((c) => c <= 3);
  if (sky.length === 0) return { tempF, code: mostCommon(dayCodes) };
  const mean = sky.reduce((sum, c) => sum + c, 0) / sky.length;
  return { tempF, code: Math.round(mean) };
}

export async function fetchHistoricalWeather(
  lat: number,
  lng: number,
  date: Date,
): Promise<WeatherResult | undefined> {
  const day = date.toISOString().slice(0, 10);
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&start_date=${day}&end_date=${day}` +
    `&hourly=temperature_2m,weathercode&timezone=auto` +
    `&temperature_unit=fahrenheit`;

  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      hourly?: {
        temperature_2m?: (number | null)[];
        weathercode?: (number | null)[];
      };
    };
    const temps = json.hourly?.temperature_2m;
    const codes = json.hourly?.weathercode;
    if (!temps || !codes) return undefined;
    return summarizeDaytime(temps, codes);
  } catch {
    return undefined;
  }
}
