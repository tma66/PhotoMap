// A long flight's progress over time (maplibregl's flyTo `easing`): CSS
// "ease", MapLibre's default, as if over `fullMs`, played in real time until
// `keepMs`, then faster and faster so it lands at `durationMs`. The take-off
// looks the same as a `fullMs` flight; the descent follows the same path,
// sooner, losing most of its slow creep to the last zoom (its tiles already
// loaded). Time runs through a quadratic warp, at normal speed at `keepMs`,
// so there's no jolt there, and the ease still ends at rest.

// CSS cubic-bezier(x1, y1, x2, y2): y for a given x (time), by Newton steps.
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  return (time: number): number => {
    let t = time;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - time;
      const slope = dx(t);
      if (Math.abs(error) < 1e-7 || Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return y(t);
  };
}

export const ease = cubicBezier(0.25, 0.1, 0.25, 1);

export function shortenedEase(
  fullMs: number,
  keepMs: number,
  durationMs: number,
): (t: number) => number {
  const rest = durationMs - keepMs;
  // Warp ms → ms + a·ms² past keepMs, reaching fullMs at durationMs.
  const a = (fullMs - keepMs - rest) / (rest * rest);
  return (t) => {
    const ms = t * durationMs;
    if (ms <= keepMs) return ease(ms / fullMs);
    const s = ms - keepMs;
    return ease(Math.min(1, (keepMs + s + a * s * s) / fullMs));
  };
}
