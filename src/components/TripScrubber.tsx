"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface TripScrubberHandle {
  /** Moves the fill/pill directly via the DOM, bypassing React re-render —
   * called up to 60x/sec while the carousel scrolls (see TripView.tsx), so
   * routing it through state would re-render this component every frame. */
  setProgress: (ratio: number) => void;
}

interface TripScrubberProps {
  dayNumbers: number[];
  activeIndex: number;
  onChange: (index: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}

// A single translucent-blue pill/bar: the "Day N" label doubles as the
// moving leading edge of the progress track, with a trailing fill left
// behind it. Dragging or tapping the track jumps between steps, evenly
// spaced by index (not by elapsed time, so steps clustered in time stay
// easy to hit).
const TripScrubber = forwardRef<TripScrubberHandle, TripScrubberProps>(
  function TripScrubber(
    { dayNumbers, activeIndex, onChange, onScrubStart, onScrubEnd },
    ref,
  ) {
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const pillRef = useRef<HTMLSpanElement>(null);
    const lastIndexRef = useRef(activeIndex);
    // Live pointer ratio while dragging this control directly, so its own
    // fill tracks the finger instead of jumping between rounded index
    // positions. Infrequent (a discrete user gesture) — fine as state,
    // unlike the carousel-scroll-driven updates via setProgress above.
    const [dragRatio, setDragRatio] = useState<number | null>(null);

    const applyFill = (ratio: number) => {
      const percent = ratio * 100;
      if (fillRef.current) fillRef.current.style.width = `${percent}%`;
      if (pillRef.current) {
        pillRef.current.style.left = `${percent}%`;
        pillRef.current.style.transform = `translateX(-${percent}%)`;
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        setProgress: (ratio: number) => {
          if (dragRatio != null) return; // a live scrubber drag takes priority
          applyFill(ratio);
        },
      }),
      [dragRatio],
    );

    if (dayNumbers.length <= 1) return null;

    const ratioFromPointerX = (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return lastIndexRef.current / (dayNumbers.length - 1);
      const rect = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    const updateFromPointerX = (clientX: number) => {
      const ratio = ratioFromPointerX(clientX);
      setDragRatio(ratio);
      const i = Math.round(ratio * (dayNumbers.length - 1));
      if (i !== lastIndexRef.current) {
        lastIndexRef.current = i;
        onChange(i);
      }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      onScrubStart();
      updateFromPointerX(e.clientX);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.buttons === 0) return;
      updateFromPointerX(e.clientX);
    };

    const handlePointerUp = () => {
      setDragRatio(null);
      onScrubEnd();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft" && activeIndex > 0) {
        onChange(activeIndex - 1);
      } else if (
        e.key === "ArrowRight" &&
        activeIndex < dayNumbers.length - 1
      ) {
        onChange(activeIndex + 1);
      }
    };

    // Baseline position for renders triggered by activeIndex/dragRatio
    // changes (infrequent) — setProgress (above) takes over the DOM style
    // for every frame in between, without re-rendering this component.
    const fillPercent =
      (dragRatio ?? activeIndex / (dayNumbers.length - 1)) * 100;

    return (
      <div className="relative mb-2 h-9">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-valuemin={1}
          aria-valuemax={dayNumbers.length}
          aria-valuenow={activeIndex + 1}
          aria-valuetext={`Day ${dayNumbers[activeIndex]}`}
          className="absolute inset-x-4 inset-y-0 touch-none cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          {/* Thin visual track + fill, centered on the pill's own vertical
              midline (not the full touch-target height) — kept much shorter
              than the pill so the pill visibly stands out as the "current
              position" marker. Matching the pill's center this way also keeps
              the two rounded (capsule) shapes' overlap free of the
              crescent-shaped gaps that show up when two rounded pieces of
              different heights meet — the pill's corner curve barely recedes
              this close to its center. */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-white/40" />
          <div
            ref={fillRef}
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-ps-link/70"
            style={{ width: `${fillPercent}%` }}
          />
          {/* The pill itself IS the moving edge of the bar (same color, no gap
              above the track) — full touch-target height, so it visually
              stands out from the thin track. `left: X%` + `translateX(-X%)`
              (a percentage of the pill's OWN width, not the track's) is the
              standard edge-to-edge slider-thumb trick: at 0% its left edge
              sits flush with the track's left edge, at 100% its right edge
              sits flush with the right edge, regardless of the pill's
              (text-length-dependent) width. */}
          <span
            ref={pillRef}
            className="absolute inset-y-0 flex items-center bg-ps-link/70 text-white text-xs font-semibold px-3 rounded-full shadow-soft whitespace-nowrap pointer-events-none"
            style={{
              left: `${fillPercent}%`,
              transform: `translateX(-${fillPercent}%)`,
            }}
          >
            DAY {dayNumbers[activeIndex]}
          </span>
        </div>
      </div>
    );
  },
);

export default TripScrubber;
