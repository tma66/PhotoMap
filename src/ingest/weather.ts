// Historical weather for a step's date/place, from Open-Meteo's free
// archive API (no key required). Only coordinates + date are sent — no
// personal data. Failures are non-fatal: a step just shows no weather tag.
interface WeatherResult {
  tempF: number;
  code: number;
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
    `&daily=temperature_2m_mean,weathercode&timezone=auto` +
    `&temperature_unit=fahrenheit`;

  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      daily?: { temperature_2m_mean?: number[]; weathercode?: number[] };
    };
    const temp = json.daily?.temperature_2m_mean?.[0];
    const code = json.daily?.weathercode?.[0];
    if (typeof temp !== "number" || typeof code !== "number") return undefined;
    return { tempF: Math.round(temp), code };
  } catch {
    return undefined;
  }
}
