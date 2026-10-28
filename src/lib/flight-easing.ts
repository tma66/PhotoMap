// A long flight's progress over time (maplibregl's flyTo `easing`): CSS
// "ease", MapLibre's default, as if over `fullMs`, until `keepMs`; then a
// quicker finish to `durationMs`. Under the default the last ~1.4 s of a 5 s
// flight only creeps from zoom ~11.8 to 13, its tiles already loaded; this
// keeps the take-off, globe and most of the descent unchanged and trims that
// creep. The finish (a cubic Hermite) starts at the ease's speed and ends at
// rest, so there's no jolt at the switch or on landing.

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

export function trimmedEase(
  fullMs: number,
  keepMs: number,
  durationMs: number,
): (t: number) => number {
  const x0 = keepMs / fullMs;
  const p0 = ease(x0);
  const h = 1e-4;
  // Speed at the switch, in the finish's own 0–1 time.
  const m0 =
    ((ease(x0 + h) - ease(x0 - h)) / (2 * h)) *
    ((durationMs - keepMs) / fullMs);
  return (t) => {
    const ms = t * durationMs;
    if (ms <= keepMs) return ease(ms / fullMs);
    const u = Math.min(1, (ms - keepMs) / (durationMs - keepMs));
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2)
    );
  };
}
