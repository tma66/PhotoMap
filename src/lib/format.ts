const UNITS = (process.env.UNITS ?? "km").toLowerCase() === "mi" ? "mi" : "km";

/** Convert a km figure to the configured display unit and round for display. */
export function formatDistance(km: number): string {
  const value = UNITS === "mi" ? km * 0.621371 : km;
  return `${Math.round(value).toLocaleString()} ${UNITS}`;
}

// `date` here is always "naive local wall-clock time encoded as if it were
// UTC" (see src/ingest/timezone.ts) — a real timezone name would double-shift
// it. `timeZone: "UTC"` reads the encoded numbers back out as-is, regardless
// of the server's own local timezone.
export function formatDayMonth(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function formatMonthYearCaps(date: Date): string {
  return date
    .toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

/** "SUN, AUG 16, 2026" — for the trip-started/trip-finished bookend cards. */
export function formatBookendDate(date: Date): string {
  return date
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

export function countryCodeToFlagEmoji(cc: string): string {
  if (!/^[A-Za-z]{2}$/.test(cc)) return "";
  const codePoints = [...cc.toUpperCase()].map(
    (c) => 0x1f1e6 + (c.charCodeAt(0) - 65),
  );
  return String.fromCodePoint(...codePoints);
}

const WEATHER_ICONS: Record<number, string> = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌦️",
  61: "🌧️",
  63: "🌧️",
  65: "🌧️",
  71: "🌨️",
  73: "🌨️",
  75: "🌨️",
  80: "🌦️",
  81: "🌧️",
  82: "⛈️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};

/** Open-Meteo WMO weather code -> emoji, for the small weather tag on a step. */
export function weatherCodeToIcon(code: number | null | undefined): string {
  if (code == null) return "";
  return WEATHER_ICONS[code] ?? "🌡️";
}
