const UNITS = (process.env.UNITS ?? "km").toLowerCase() === "mi" ? "mi" : "km";

/** Convert a km figure to the configured display unit and round for display. */
export function formatDistance(km: number): string {
  const value = UNITS === "mi" ? km * 0.621371 : km;
  return `${Math.round(value).toLocaleString()} ${UNITS}`;
}

export function formatDayMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDayMonth(date: Date): string {
  return date.toLocaleDateString("en-US", { day: "numeric", month: "long" });
}

export function formatMonthYearCaps(date: Date): string {
  return date
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
}

/** "3 hours" / "2 days" gap between two timestamps, for the timeline connector. */
export function formatTravelGap(fromMs: number, toMs: number): string {
  const diffMs = Math.max(0, toMs - fromMs);
  const hours = diffMs / 3_600_000;
  if (hours < 1) {
    const mins = Math.max(1, Math.round(diffMs / 60_000));
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
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
