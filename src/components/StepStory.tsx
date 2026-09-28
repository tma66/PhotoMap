"use client";

import { useEffect, useRef, useState } from "react";
import type { StepView } from "@/lib/trip-view";
import { BackChevronIcon, SpeakerIcon } from "./icons";

const PHOTO_DURATION_S = 5;
const SETTLE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// The settle/complete animation runs at roughly this speed rather than a
// fixed duration, so it covers however much distance is actually left from
// wherever the finger let go — a fixed duration made a swipe released early
// crawl through most of the screen and one released late snap the last few
// pixels just as slowly, neither of which reads as a continuation of the
// drag the way iOS Photos does. A fast flick's own velocity can push the
// speed higher still, clamped to a sane range either way.
const SETTLE_PX_PER_MS = 0.5;
const MIN_SETTLE_MS = 360;
const MAX_SETTLE_MS = 840;
// A fast flick commits the step swap even if released before the distance
// threshold below — matching iOS Photos, where a quick flick from anywhere
// advances the page instead of springing back just because the finger
// didn't travel far.
const FLING_VELOCITY_PX_PER_MS = 0.5;
// SETTLE_EASE is a heavy ease-out (easeOutQuint): by roughly the halfway
// point of `settleMs`, the incoming photo has already covered ~95%+ of the
// distance and looks fully arrived — the remaining time is a barely-moving
// tail. Remounting into the next step (which brings its own fresh progress
// bar) at this fraction of `settleMs`, instead of waiting for the full,
// linear-timed duration, makes that bar show up as soon as the photo
// actually looks done rather than lagging behind it. Lower fractions (1/4,
// 1/8) were tried and rejected — the photo visibly snaps the rest of the
// way in before it's fully arrived.
const REMOUNT_FRACTION = 0.5;

function settleDurationMs(
  remainingPx: number,
  velocityPxPerMs: number,
): number {
  const speed = Math.max(SETTLE_PX_PER_MS, Math.abs(velocityPxPerMs));
  const ms = Math.abs(remainingPx) / speed;
  return Math.min(MAX_SETTLE_MS, Math.max(MIN_SETTLE_MS, ms));
}
// Fixed screen-space gutter between the current photo and the adjacent
// step's preview while dragging, like the gap between pages in iOS Photos —
// stays a constant pixel width regardless of container size or drag
// progress, rather than scaling with either.
const PAGE_GAP_PX = 32;

interface StepStoryProps {
  steps: StepView[];
  stepIndex: number;
  /** Which media item to start on — used when arriving via "previous step"
   * so it lands on the last item rather than jumping back to the first.
   * The parent remounts this component (via a `key`) on every stepIndex
   * change, so reading this once into useState's initializer is enough. */
  initialMediaIndex?: number;
  /** The tapped card's on-screen rect at the moment the story was opened —
   * only set on the initial open (not on a swipe-driven step change), so it
   * animates in from that card once and doesn't replay on every swipe. */
  originRect?: DOMRect | null;
  /** Tells the parent it can clear `originRect` — called right after it's
   * been read for the entrance animation, well before any later swipe could
   * trigger the next remount, so that remount doesn't see a stale value and
   * replay the entrance animation. */
  onOriginConsumed?: () => void;
  /** Looks up a step's card rect on demand (rather than passing one down),
   * since the close target is whichever step is on screen *when the visitor
   * closes* — which may not be the step the story was opened on, if they've
   * swiped since. */
  getCardRect?: (stepId: string) => DOMRect | null;
  onClose: () => void;
  onStepIndexChange: (index: number, enterAtEnd?: boolean) => void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Card corner radius (rounded-3xl, see StepCarousel.tsx) to animate toward
// on close / away from on open, so the shape reads as the same object
// growing into, or shrinking back into, the card — not just a plain scale.
const CARD_BORDER_RADIUS = "24px";
const ZOOM_TRANSITION_MS = 320;
const ZOOM_EASE = "cubic-bezier(0.32, 0.72, 0.35, 1)";

/** Keyframe (relative to `el`'s own full-screen rect) that visually
 * overlays `el` exactly onto the card at `target` — used to animate between
 * the full-screen story and the card it opened from/closes to. */
function onCard(el: HTMLElement, target: DOMRect): Keyframe {
  const full = el.getBoundingClientRect();
  const tx = target.left - full.left;
  const ty = target.top - full.top;
  const sx = target.width / full.width;
  const sy = target.height / full.height;
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`,
    borderRadius: CARD_BORDER_RADIUS,
  };
}
const FULL_SCREEN: Keyframe = {
  transform: "translate(0px, 0px) scale(1, 1)",
  borderRadius: "0px",
};

// fill: "forwards" holds the end state once the animation finishes —
// without it, a close would snap back to full screen for a frame or two
// before the parent actually unmounts the story.
function zoom(el: HTMLElement, from: Keyframe, to: Keyframe): Animation {
  return el.animate([from, to], {
    duration: ZOOM_TRANSITION_MS,
    easing: ZOOM_EASE,
    fill: "forwards",
  });
}

export default function StepStory({
  steps,
  stepIndex,
  initialMediaIndex = 0,
  originRect,
  onOriginConsumed,
  getCardRect,
  onClose,
  onStepIndexChange,
}: StepStoryProps) {
  const step = steps[stepIndex]!;
  const [mediaIndex, setMediaIndex] = useState(initialMediaIndex);
  const [paused, setPaused] = useState(false);
  const [journalExpanded, setJournalExpanded] = useState(false);
  // Persists across videos for the rest of this story session (like a
  // volume setting), rather than resetting to muted on every clip.
  const [videoMuted, setVideoMuted] = useState(true);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // Most recent touchmove point/time, for a rough release velocity estimate
  // (see settleDurationMs) — a flick should complete faster than a slow drag
  // released at the same position.
  const lastMoveRef = useRef<{ x: number; t: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLayerRef = useRef<HTMLDivElement>(null);
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const nextLayerRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  // True once an in-progress touch has committed to a horizontal drag (vs.
  // a vertical swipe-to-close or a plain tap) — decided on the first move
  // past a small jitter deadzone, then fixed for the rest of that touch.
  const isHorizontalDragRef = useRef(false);

  // Drags the current/prev/next media layers together like an iOS photo
  // swipe — dx applied on top of each layer's resting offset (the
  // container's own -100%/0/100% width, plus a fixed gap pushing the
  // neighbors further out so a gutter shows between pages). `settleMs`
  // animates the move over that duration (settling back to rest, or
  // finishing the swipe); omitted, live dragging applies it instantly so the
  // photo tracks the finger 1:1.
  const setDragLayers = (dx: number, settleMs?: number) => {
    const transition =
      settleMs != null ? `transform ${settleMs}ms ${SETTLE_EASE}` : "none";
    for (const [el, base] of [
      [prevLayerRef.current, `-100% - ${PAGE_GAP_PX}px`],
      [currentLayerRef.current, "0%"],
      [nextLayerRef.current, `100% + ${PAGE_GAP_PX}px`],
    ] as const) {
      if (!el) continue;
      el.style.transition = transition;
      el.style.transform = `translateX(calc(${base} + ${dx}px))`;
    }
  };

  const media = step.media[mediaIndex];

  // Animates the story shrinking back down onto the card it closes to
  // (whichever step is currently on screen — see the getCardRect prop doc)
  // before actually calling onClose, unless reduced motion is preferred or
  // there's no card rect to animate to (e.g. this step scrolled out of the
  // carousel's rendered range).
  const closeWithAnimation = () => {
    const el = containerRef.current;
    const rect = getCardRect?.(step.id);
    if (!el || !rect || prefersReducedMotion()) {
      onClose();
      return;
    }
    zoom(el, FULL_SCREEN, onCard(el, rect)).finished.then(onClose, onClose);
  };

  const goNext = () => {
    if (mediaIndex < step.media.length - 1) {
      setMediaIndex((i) => i + 1);
    } else if (stepIndex < steps.length - 1) {
      onStepIndexChange(stepIndex + 1);
    } else {
      closeWithAnimation();
    }
  };

  const goPrev = () => {
    if (mediaIndex > 0) {
      setMediaIndex((i) => i - 1);
    } else if (stepIndex > 0) {
      onStepIndexChange(stepIndex - 1, true);
    }
  };

  // Preload the next photo/video so advancing to it (tap, swipe, or
  // auto-advance) doesn't show a blank frame — or, for video, a poster held
  // on screen while playback data is still being fetched — before it's
  // ready.
  useEffect(() => {
    const next = step.media[mediaIndex + 1];
    if (!next) return;
    if (next.type === "VIDEO" && next.videoUrl) {
      const video = document.createElement("video");
      video.preload = "auto";
      video.src = next.videoUrl;
      video.load();
    } else {
      const img = new Image();
      img.src = next.displayUrl;
    }
  }, [step, mediaIndex]);

  // Animates in from the tapped card's rect on the initial open — see
  // originRect's doc comment for why this only ever fires once, not on a
  // later swipe-driven remount.
  useEffect(() => {
    if (!originRect) return;
    onOriginConsumed?.();
    const el = containerRef.current;
    if (!el || prefersReducedMotion()) return;
    zoom(el, onCard(el, originRect), FULL_SCREEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount, for the rect this instance was created with
  }, []);

  if (!media) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-black overflow-hidden"
      style={{ maxWidth: 480, margin: "0 auto" }}
      onTouchStart={(e) => {
        const t = e.touches[0]!;
        touchStart.current = { x: t.clientX, y: t.clientY };
        lastMoveRef.current = { x: t.clientX, t: performance.now() };
        isHorizontalDragRef.current = false;
        setPaused(true);
      }}
      onTouchMove={(e) => {
        const start = touchStart.current;
        if (!start) return;
        const t = e.touches[0]!;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (!isHorizontalDragRef.current) {
          // Small jitter deadzone, then commit to horizontal drag vs. — a
          // vertical gesture is left alone here; touchEnd's dy check still
          // handles swipe-to-close.
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          if (Math.abs(dy) > Math.abs(dx)) return;
          isHorizontalDragRef.current = true;
        }
        setDragLayers(dx);
        lastMoveRef.current = { x: t.clientX, t: performance.now() };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) {
          setPaused(false);
          return;
        }
        const t = e.changedTouches[0]!;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;

        // A very fast swipe can end before `onTouchMove` ever samples it
        // (the browser may coalesce or drop intermediate touchmove events
        // under a quick flick), leaving isHorizontalDragRef false even
        // though the finger clearly moved — fall back to the aggregate
        // start-to-end delta so a fast swipe isn't misread as a tap (which
        // would resume the old photo's paused timer and fire the
        // underlying tap-zone button's single-photo advance instead of the
        // intended step swap).
        const isHorizontalDrag =
          isHorizontalDragRef.current ||
          (Math.abs(dx) >= 10 && Math.abs(dx) > Math.abs(dy));

        if (!isHorizontalDrag) {
          setPaused(false);
          if (dy > 80 && Math.abs(dy) > Math.abs(dx)) closeWithAnimation();
          return;
        }

        // A horizontal swipe jumps straight to the next/previous step
        // (unlike a tap, which advances one photo at a time within the
        // current step) — dragged the rest of the way off-screen like an
        // iOS photo swipe once past ~30% of the screen, otherwise it
        // springs back to where it started.
        const width = containerRef.current?.clientWidth ?? window.innerWidth;
        const goingNext = dx < 0;
        const canGo = goingNext ? stepIndex < steps.length - 1 : stepIndex > 0;
        const pastThreshold = Math.abs(dx) > width * 0.3;

        const last = lastMoveRef.current;
        const now = performance.now();
        const velocityPxPerMs =
          last && now > last.t ? (t.clientX - last.x) / (now - last.t) : 0;
        // A quick flick in the drag's own direction commits the swipe even
        // if it hasn't crossed the distance threshold yet.
        const isFling =
          Math.abs(velocityPxPerMs) > FLING_VELOCITY_PX_PER_MS &&
          velocityPxPerMs < 0 === goingNext;

        if (canGo && (pastThreshold || isFling)) {
          const moveBy = width + PAGE_GAP_PX;
          const targetDx = goingNext ? -moveBy : moveBy;
          const settleMs = settleDurationMs(targetDx - dx, velocityPxPerMs);
          setDragLayers(targetDx, settleMs);
          // The settle animation eases out, so the photo visually arrives
          // well before `settleMs` (its nominal, linear-timed duration) is
          // up — the remount that brings in the next step's own fresh
          // progress bar only happens once that timer fires below. Hiding
          // this (old, frozen) bar right away avoids it looking stuck for
          // that gap between "photo looks parked" and "remount happens".
          if (progressBarRef.current) {
            progressBarRef.current.style.transition = "opacity 120ms ease-out";
            progressBarRef.current.style.opacity = "0";
          }
          window.setTimeout(() => {
            onStepIndexChange(goingNext ? stepIndex + 1 : stepIndex - 1);
          }, settleMs * REMOUNT_FRACTION);
        } else {
          setDragLayers(0, settleDurationMs(dx, velocityPxPerMs));
          setPaused(false);
        }
      }}
    >
      {/* Progress bars — the active one fills via a CSS animation (paused/
          resumed with animation-play-state) rather than a per-frame React
          state update, so a 5s photo doesn't re-render the story at 60fps. */}
      <div
        ref={progressBarRef}
        className="absolute top-0 inset-x-0 z-20 safe-top px-2 flex gap-1 pt-2"
      >
        {step.media.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden"
          >
            {i === mediaIndex ? (
              <div
                className="h-full bg-white"
                style={{
                  animationName: "story-progress-fill",
                  animationDuration: `${media.durationSec ?? PHOTO_DURATION_S}s`,
                  animationTimingFunction: "linear",
                  animationFillMode: "forwards",
                  animationPlayState: paused ? "paused" : "running",
                }}
                onAnimationEnd={() => {
                  // Guards a rare race: if the animation finishes in the
                  // same instant a touch starts, this can fire a frame
                  // before the `paused` state above has actually reached
                  // the DOM, advancing the photo out from under an
                  // in-progress drag (visible as a flicker to the old
                  // photo, then the new one).
                  if (touchStart.current === null) goNext();
                }}
              />
            ) : (
              <div
                className="h-full bg-white"
                style={{ width: i < mediaIndex ? "100%" : "0%" }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Matches MapOverlayHeader's back button exactly (size + position:
          safe-top, px-4, then the same owner-row-height spacer) so it
          doesn't jump when opening/closing the story from the trip map. */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 safe-top">
        <div className="h-5 mb-1" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={closeWithAnimation}
            aria-label="Close"
            className="w-12 h-12 rounded-full glass-button flex items-center justify-center shadow-soft"
          >
            <BackChevronIcon size={28} />
          </button>
          {media.type === "VIDEO" && (
            <button
              type="button"
              onClick={() => setVideoMuted((m) => !m)}
              aria-label={videoMuted ? "Unmute video" : "Mute video"}
              className="w-12 h-12 rounded-full glass-button flex items-center justify-center shadow-soft"
            >
              <SpeakerIcon muted={videoMuted} size={28} />
            </button>
          )}
        </div>
      </div>

      {/* Media — current step plus a preview of the adjacent step on each
          side, dragged together during a swipe (see setDragLayers). */}
      <div
        ref={prevLayerRef}
        className="absolute inset-0"
        style={{ transform: `translateX(calc(-100% - ${PAGE_GAP_PX}px))` }}
      >
        <StepCoverPreview step={steps[stepIndex - 1]} />
      </div>
      <div
        ref={currentLayerRef}
        className="absolute inset-0"
        style={{ transform: "translateX(0%)" }}
      >
        {media.type === "VIDEO" && media.videoUrl ? (
          // key remounts on every media change so autoplay actually
          // (re)triggers, and so the poster-fade state below resets per clip.
          <VideoWithPoster
            key={media.hash}
            src={media.videoUrl}
            poster={media.displayUrl}
            muted={videoMuted}
          />
        ) : (
          <StoryPhoto media={media} />
        )}
      </div>
      <div
        ref={nextLayerRef}
        className="absolute inset-0"
        style={{ transform: `translateX(calc(100% + ${PAGE_GAP_PX}px))` }}
      >
        <StepCoverPreview step={steps[stepIndex + 1]} />
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
          {step.weatherTempF != null && (
            <>
              {" "}
              · {step.weatherIcon} {step.weatherTempF}°F
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
      </div>
    </div>
  );
}

// The <video>'s own swap from its poster frame to decoded playback happens
// however the browser times it and can't be smoothed directly — so instead
// an <img> of the same poster sits on top and fades out via CSS transition
// once `onPlaying` fires, crossfading over whatever the video underneath is
// showing at that moment instead of popping straight to it.
function VideoWithPoster({
  src,
  poster,
  muted,
}: {
  src: string;
  poster: string;
  muted: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        src={src}
        poster={poster}
        preload="auto"
        autoPlay
        muted={muted}
        playsInline
        onPlaying={() => setPlaying(true)}
        className="absolute inset-0 w-full h-full object-contain bg-black"
      />
      {/* A slight scale-up alongside the fade, like Live Photos coming to
          life in Apple's Photos app, rather than a flat dissolve. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt=""
        decoding="async"
        className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none"
        style={{
          opacity: playing ? 0 : 1,
          transform: playing ? "scale(1.015)" : "scale(1)",
          transition: `opacity 500ms ${ZOOM_EASE}, transform 500ms ${ZOOM_EASE}`,
        }}
      />
    </div>
  );
}

// The adjacent step's cover photo, shown sliding in from the edge while
// dragging — not a full story (no progress bars/journal), since it's only
// ever visible mid-swipe or for one settle animation before the parent
// remounts the real thing. Deliberately the same displayUrl the remounted
// story will show for that photo, not a cheaper thumbnail — using a
// different image here means the browser can't serve the remount from
// cache, so completing the swipe flashes thumb → blur placeholder → sharp
// photo instead of landing on an already-loaded frame.
function StepCoverPreview({ step }: { step?: StepView }) {
  const cover = step?.media[0];
  return cover ? (
    <StoryPhoto media={cover} />
  ) : (
    <div className="w-full h-full bg-black" />
  );
}

/** A full-screen photo over its blurred placeholder. */
function StoryPhoto({ media }: { media: StepView["media"][number] }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={media.displayUrl}
      alt=""
      decoding="async"
      className="w-full h-full object-contain bg-black bg-contain bg-center bg-no-repeat"
      style={
        media.placeholder
          ? { backgroundImage: `url(${media.placeholder})` }
          : undefined
      }
    />
  );
}
