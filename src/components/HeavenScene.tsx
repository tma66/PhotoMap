"use client";

import { useEffect, useState } from "react";

// The paradise a step at 0,0 lives in (see src/lib/heaven.ts): a cloud island
// floating over the top of the globe, with the step's photo pin on it.
// TripMap positions it so its bottom edge rests on the globe's top edge, and
// toggles `visible` once the camera has pulled back to the globe.

const CLOUD_PUFFS: [number, number, number][] = [
  [108, 130, 26],
  [138, 110, 34],
  [172, 98, 40],
  [208, 108, 34],
  [238, 128, 25],
];

const SPARKLES: [number, number, number][] = [
  [52, 70, 0],
  [292, 56, 0.8],
  [36, 150, 1.6],
  [306, 150, 2.3],
  [110, 34, 1.2],
  [236, 28, 0.4],
];

const sparkle = (x: number, y: number) =>
  `M ${x} ${y - 6} L ${x + 1.5} ${y - 1.5} L ${x + 6} ${y} L ${x + 1.5} ${y + 1.5} L ${x} ${y + 6} L ${x - 1.5} ${y + 1.5} L ${x - 6} ${y} L ${x - 1.5} ${y - 1.5} Z`;

export default function HeavenScene({
  visible,
  globeTop,
  width,
  photoUrl,
  label,
  onSelect,
}: {
  visible: boolean;
  /** Screen y (px, within the map) of the globe's top edge. */
  globeTop: number;
  /** Scene width (px), scaled to the globe. */
  width: number;
  photoUrl: string | null;
  label: string;
  onSelect: () => void;
}) {
  // Applied a frame late, so a scene that mounts already visible still
  // fades in from hidden instead of popping up.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(visible));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  return (
    <div
      className="heaven-anchor"
      style={{ top: globeTop, width }}
      data-visible={shown}
    >
      <div className="heaven-scene">
        <svg viewBox="0 0 340 190" className="w-full h-full overflow-visible">
          <defs>
            <radialGradient id="heaven-glow">
              <stop offset="0%" stopColor="#fff3bf" stopOpacity="0.9" />
              <stop offset="45%" stopColor="#ffe8a3" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#ffe8a3" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="heaven-cloud" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e7edf8" />
            </linearGradient>
          </defs>

          <circle
            className="heaven-glow"
            cx="170"
            cy="90"
            r="150"
            fill="url(#heaven-glow)"
          />

          <g className="heaven-float">
            {CLOUD_PUFFS.map(([cx, cy, r]) => (
              <circle
                key={cx}
                cx={cx}
                cy={cy}
                r={r}
                fill="url(#heaven-cloud)"
              />
            ))}
            <ellipse
              cx="172"
              cy="140"
              rx="98"
              ry="20"
              fill="url(#heaven-cloud)"
            />
          </g>

          {SPARKLES.map(([x, y, delay]) => (
            <path
              key={x}
              className="heaven-sparkle"
              d={sparkle(x, y)}
              fill="#fff9db"
              style={{ animationDelay: `${delay}s` }}
            />
          ))}
        </svg>

        <div className="heaven-pin-spot">
          <div className="heaven-float">
            <div className="heaven-halo" />
            <button
              type="button"
              aria-label={label}
              onClick={onSelect}
              className="trip-pin trip-pin-active heaven-pin"
            >
              <div className="trip-pin-photo">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="" />
                ) : (
                  <div className="trip-pin-fallback" />
                )}
              </div>
              <span className="trip-pin-label">{label}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
