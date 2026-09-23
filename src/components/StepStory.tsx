"use client";

import { useEffect, useRef, useState } from "react";
import type { StepView } from "@/lib/trip-view";

const PHOTO_DURATION_MS = 5000;

interface StepStoryProps {
  steps: StepView[];
  stepIndex: number;
  /** Which media item to start on — used when arriving via "previous step"
   * so it lands on the last item rather than jumping back to the first.
   * The parent remounts this component (via a `key`) on every stepIndex
   * change, so reading this once into useState's initializer is enough. */
  initialMediaIndex?: number;
  onClose: () => void;
  onStepIndexChange: (index: number, enterAtEnd?: boolean) => void;
}

export default function StepStory({
  steps,
  stepIndex,
  initialMediaIndex = 0,
  onClose,
  onStepIndexChange,
}: StepStoryProps) {
  const step = steps[stepIndex]!;
  const [mediaIndex, setMediaIndex] = useState(initialMediaIndex);
  const [progress, setProgress] = useState(0); // 0..1 within current media item
  const [paused, setPaused] = useState(false);
  const [journalExpanded, setJournalExpanded] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const media = step.media[mediaIndex];
  const isVideo = media?.type === "VIDEO";

  const goNext = () => {
    if (mediaIndex < step.media.length - 1) {
      setMediaIndex((i) => i + 1);
    } else if (stepIndex < steps.length - 1) {
      onStepIndexChange(stepIndex + 1);
    } else {
      onClose();
    }
  };

  const goPrev = () => {
    if (mediaIndex > 0) {
      setMediaIndex((i) => i - 1);
    } else if (stepIndex > 0) {
      onStepIndexChange(stepIndex - 1, true);
    }
  };

  // Photo auto-advance.
  useEffect(() => {
    if (isVideo || paused) return;
    const start = performance.now() - progress * PHOTO_DURATION_MS;
    const tick = (now: number) => {
      const p = (now - start) / PHOTO_DURATION_MS;
      if (p >= 1) {
        goNext();
        return;
      }
      setProgress(p);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaIndex, isVideo, paused]);

  if (!media) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black"
      style={{ maxWidth: 480, margin: "0 auto" }}
      onTouchStart={(e) => {
        const t = e.touches[0]!;
        touchStart.current = { x: t.clientX, y: t.clientY };
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        setPaused(false);
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
          onClose();
          return;
        }
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // treated as a tap, handled by the left/right zones below
        }
      }}
    >
      {/* Progress bars */}
      <div className="absolute top-0 inset-x-0 z-20 safe-top px-2 flex gap-1 pt-2">
        {step.media.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden"
          >
            <div
              className="h-full bg-white"
              style={{
                width: `${i < mediaIndex ? 100 : i === mediaIndex ? progress * 100 : 0}%`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="absolute top-7 inset-x-0 z-20 px-3 safe-top flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18l-6-6 6-6"
              stroke="#00293D"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Media */}
      <div className="absolute inset-0">
        {isVideo ? (
          <video
            key={media.hash}
            src={media.displayUrl}
            className="w-full h-full object-contain bg-black"
            autoPlay
            playsInline
            muted
            onEnded={goNext}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.displayUrl}
            alt=""
            className="w-full h-full object-contain bg-black bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${media.placeholder})` }}
          />
        )}
      </div>

      {/* Tap zones */}
      <button
        aria-label="Previous"
        onClick={goPrev}
        className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
      />
      <button
        aria-label="Next"
        onClick={goNext}
        className="absolute right-0 top-0 bottom-0 w-2/3 z-10"
      />

      {/* Bottom info */}
      <div className="absolute bottom-0 inset-x-0 z-20 safe-bottom px-4 pt-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
        <p className="text-white font-bold text-lg">{step.title}</p>
        <p className="text-white/80 text-xs uppercase tracking-wide mt-0.5">
          {step.flag} {step.countryName || step.countryCode} · {step.dateLabel}
          {step.weatherTempC != null && (
            <>
              {" "}
              · {step.weatherIcon} {step.weatherTempC}°
            </>
          )}
        </p>
        {step.journalText && (
          <div
            className="relative z-30 mt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className={`text-white/90 text-sm font-serif ${journalExpanded ? "" : "line-clamp-2"}`}
            >
              {step.journalText}
            </p>
            <button
              type="button"
              className="text-white/70 text-xs font-sans font-semibold mt-1"
              onClick={() => setJournalExpanded((v) => !v)}
            >
              {journalExpanded ? "Show less" : "Show more"}
            </button>
          </div>
        )}
        {step.travelGapLabel && (
          <p className="text-white/60 text-xs mt-2">
            Traveled for {step.travelGapLabel}
          </p>
        )}
      </div>
    </div>
  );
}
