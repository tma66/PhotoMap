"use client";

import { useEffect, useRef, useState } from "react";
import type { StepView } from "@/lib/trip-view";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import { BackChevronIcon, SpeakerIcon } from "./icons";

const PHOTO_DURATION_S = 5;
// A press held longer than this is a pause (hold to look), not a tap — its
// release resumes the current photo instead of advancing.
const HOLD_MS = 250;
/** How many items ahead to preload photos (~190 KB each). */
const PHOTO_PRELOAD = 3;
const MAX_ZOOM = 4;
// Pinched back out to (nearly) this, it settles to the unzoomed photo.
const UNZOOM_BELOW = 1.05;

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  midX: (a.x + b.x) / 2,
  midY: (a.y + b.y) / 2,
});
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
  // The hash of the photo whose timer may run, once it has loaded. Over a
  // slow link the 5s otherwise ran out while the photo was still black or
  // blurred.
  const [readyHash, setReadyHash] = useState<string | null>(null);
  // A video that can't play (refused play(), e.g. iOS Low Power Mode, or a
  // load error): its poster shows on a timer like a photo. Any other video's
  // bar follows its playback position and the story advances on `ended`, so
  // a frozen or buffering clip can't be cut short by a timer running on.
  const [videoFallbackHash, setVideoFallbackHash] = useState<string | null>(
    null,
  );
  const videoFillRef = useRef<HTMLDivElement>(null);
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
  // When the current press began, so a long hold's release isn't read as a
  // tap by the tap zones below (see HOLD_MS).
  const pressStartRef = useRef(0);
  // (0 = no touch, e.g. a mouse click, which is always a tap.)
  const wasHold = () =>
    pressStartRef.current > 0 &&
    performance.now() - pressStartRef.current > HOLD_MS;

  // Pinch-zoom on the current photo/video, built in rather than left to the
  // browser's page zoom — which the Home Screen app doesn't allow, and whose
  // pinch the swipe-to-close check below misread as a swipe down. While
  // zoomed the story stays paused, one finger pans, and taps/swipes are off
  // until it's pinched back out.
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef({ scale: 1, x: 0, y: 0 });
  const gestureRef = useRef<
    | { kind: "pinch"; dist: number; midX: number; midY: number }
    | { kind: "pan"; px: number; py: number }
    | null
  >(null);
  // The zoom when the current gesture began, which it's applied on top of.
  const gestureZoomRef = useRef({ scale: 1, x: 0, y: 0 });
  const isTap = () => zoomRef.current.scale === 1 && !wasHold();

  const applyZoom = (scale: number, x: number, y: number, animate = false) => {
    const el = zoomLayerRef.current;
    const box = containerRef.current;
    if (!el || !box) return;
    // No panning past the zoomed photo's edges.
    const maxX = ((scale - 1) * box.clientWidth) / 2;
    const maxY = ((scale - 1) * box.clientHeight) / 2;
    x = Math.min(maxX, Math.max(-maxX, x));
    y = Math.min(maxY, Math.max(-maxY, y));
    zoomRef.current = { scale, x, y };
    el.style.transition = animate ? `transform 250ms ${SETTLE_EASE}` : "none";
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  // Touch point relative to the story's center (the zoom's origin).
  const fromCenter = (x: number, y: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };

  const startGesture = (touches: React.TouchList) => {
    gestureZoomRef.current = zoomRef.current;
    const [a, b] = [touches[0]!, touches[1]];
    gestureRef.current = b
      ? {
          kind: "pinch",
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          ...mid(
            fromCenter(a.clientX, a.clientY),
            fromCenter(b.clientX, b.clientY),
          ),
        }
      : { kind: "pan", px: a.clientX, py: a.clientY };
  };

  const moveGesture = (touches: React.TouchList) => {
    const g = gestureRef.current;
    const z = gestureZoomRef.current;
    const [a, b] = [touches[0]!, touches[1]];
    if (g?.kind === "pan") {
      applyZoom(z.scale, z.x + a.clientX - g.px, z.y + a.clientY - g.py);
    } else if (g?.kind === "pinch" && b) {
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const scale = Math.min(MAX_ZOOM, Math.max(1, (z.scale * dist) / g.dist));
      const m = mid(
        fromCenter(a.clientX, a.clientY),
        fromCenter(b.clientX, b.clientY),
      );
      // Keeps the spot that was under the fingers under them, moving with
      // the pinch's midpoint.
      const k = scale / z.scale;
      applyZoom(
        scale,
        m.midX - (g.midX - z.x) * k,
        m.midY - (g.midY - z.y) * k,
      );
    }
  };

  // Stops the browser's own pinch (Safari's page zoom) from also kicking in
  // — touch-action alone isn't always honored by iOS for pinches.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener("gesturestart", block);
    return () => el.removeEventListener("gesturestart", block);
  }, []);

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
  // The next item, if it's a video, is mounted hidden and paused so it's
  // buffered and decoder-ready when it becomes current: the same keyed
  // <video> is then shown, not a fresh one. A detached preload <video> barely
  // helped on iPhone (Safari dropped it after ~190 KB and refetched the clip
  // when shown). Within this step only — the next step remounts StepStory.
  const next = step.media[mediaIndex + 1];
  const nextVideo =
    next?.type === "VIDEO" && next.videoUrl && next.hash !== media?.hash
      ? { hash: next.hash, src: next.videoUrl, poster: next.displayUrl }
      : null;
  const videoDriven =
    media?.type === "VIDEO" &&
    !!media.videoUrl &&
    videoFallbackHash !== media.hash;

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

  // Escape closes the story, as it would any dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWithAnimation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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

  // Preload the photos among the next PHOTO_PRELOAD items, decoded, so
  // advancing (tap, swipe, or auto-advance) doesn't show the blurred
  // placeholder before it's ready. One photo ahead wasn't enough over the
  // public link on cellular (~1s of blur per tap). The next video is
  // preloaded by mounting it hidden (see nextVideo below).
  const preloadedRef = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    // Held in a ref so a pending fetch isn't dropped with an unreferenced Image.
    preloadedRef.current = step.media
      .slice(mediaIndex + 1, mediaIndex + 1 + PHOTO_PRELOAD)
      .filter((m) => m.type !== "VIDEO")
      .map((m) => {
        const img = new Image();
        img.src = m.displayUrl;
        img.decode().catch(() => {});
        return img;
      });
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
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      // No text selection, copy/save callout or context menu on a long
      // press — holding is how the story is paused.
      className="fixed inset-0 z-50 bg-black overflow-hidden select-none"
      style={{
        maxWidth: 480,
        margin: "0 auto",
        WebkitTouchCallout: "none",
        touchAction: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
      onTouchStart={(e) => {
        // A second finger, or any touch while zoomed, is a zoom/pan — not
        // a tap or swipe, so that handling (below) is called off.
        if (e.touches.length > 1 || zoomRef.current.scale > 1) {
          if (touchStart.current) setDragLayers(0);
          touchStart.current = null;
          isHorizontalDragRef.current = false;
          setPaused(true);
          startGesture(e.touches);
          return;
        }
        const t = e.touches[0]!;
        pressStartRef.current = performance.now();
        touchStart.current = { x: t.clientX, y: t.clientY };
        lastMoveRef.current = { x: t.clientX, t: performance.now() };
        isHorizontalDragRef.current = false;
        setPaused(true);
      }}
      onTouchMove={(e) => {
        if (gestureRef.current) {
          moveGesture(e.touches);
          return;
        }
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
        if (gestureRef.current) {
          gestureRef.current = null;
          if (zoomRef.current.scale < UNZOOM_BELOW) {
            // Pinched back out: settle onto the photo and carry on.
            applyZoom(1, 0, 0, true);
            setPaused(false);
          } else if (e.touches.length > 0) {
            // A finger still down keeps panning from here.
            startGesture(e.touches);
          }
          return;
        }
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
          resumed with animation-play-state), or for a playing video via
          VideoWithPoster writing its width, rather than a per-frame React
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
            {i === mediaIndex && videoDriven ? (
              <div
                key={media.hash}
                ref={videoFillRef}
                className="h-full bg-white"
                style={{ width: "0%" }}
              />
            ) : i === mediaIndex ? (
              <div
                className="h-full bg-white"
                style={{
                  animationName: "story-progress-fill",
                  animationDuration: `${media.durationSec ?? PHOTO_DURATION_S}s`,
                  animationTimingFunction: "linear",
                  animationFillMode: "forwards",
                  animationPlayState:
                    paused || readyHash !== media.hash ? "paused" : "running",
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
        <div ref={zoomLayerRef} className="relative w-full h-full">
          {media.type === "VIDEO" && media.videoUrl ? (
            // key gives each clip its own element, so the poster-fade state
            // below resets per clip, and the hidden next clip's element is
            // the one shown once it becomes current.
            <VideoWithPoster
              key={media.hash}
              active
              src={media.videoUrl}
              poster={media.displayUrl}
              muted={videoMuted}
              paused={paused}
              onProgress={(fraction) => {
                if (videoFillRef.current)
                  videoFillRef.current.style.width = `${fraction * 100}%`;
              }}
              // Same drag-race guard as the bar's onAnimationEnd above.
              onEnded={() => touchStart.current === null && goNext()}
              onFallback={() => {
                setVideoFallbackHash(media.hash);
                setReadyHash(media.hash);
              }}
            />
          ) : (
            <StoryPhoto
              media={media}
              onReady={() => setReadyHash(media.hash)}
            />
          )}
          {nextVideo && (
            <VideoWithPoster
              key={nextVideo.hash}
              active={false}
              src={nextVideo.src}
              poster={nextVideo.poster}
              muted={videoMuted}
              paused
              onProgress={() => {}}
              onEnded={() => {}}
              onFallback={() => {}}
            />
          )}
        </div>
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
        onClick={() => isTap() && goPrev()}
        className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
      />
      <button
        aria-label="Next"
        onClick={() => isTap() && goNext()}
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
  active,
  src,
  poster,
  muted,
  paused,
  onProgress,
  onEnded,
  onFallback,
}: {
  /** False: the hidden next clip — buffering, paused at the start. */
  active: boolean;
  src: string;
  poster: string;
  muted: boolean;
  paused: boolean;
  /** Playback position, 0–1, every frame once playing. */
  onProgress: (fraction: number) => void;
  onEnded: () => void;
  /** Can't play (refused play() or a load error): the story shows the poster
   * on a timer instead of waiting forever. */
  onFallback: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // A load error while hidden, reported once shown: a failed <source> can
  // leave play() pending rather than rejected.
  const failedRef = useRef(false);
  const fail = () => {
    if (active) onFallback();
    else failedRef.current = true;
  };
  const callbacksRef = useRef({ onProgress, onFallback });
  useEffect(() => {
    callbacksRef.current = { onProgress, onFallback };
  });
  // Holds still alongside the progress bar while the story is held. A refused
  // play() (iOS Low Power Mode blocks autoplay) falls back to the poster on a
  // timer; an AbortError only means a quick hold's pause() interrupted it.
  // Made inactive again (stepped back past it): rewound so it restarts when
  // shown, as a fresh element would.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!active) {
      video.pause();
      video.currentTime = 0;
    } else if (failedRef.current) callbacksRef.current.onFallback();
    else if (paused) video.pause();
    else
      video.play().catch((e: DOMException) => {
        if (e.name !== "AbortError") callbacksRef.current.onFallback();
      });
  }, [active, paused]);
  // Reads currentTime per frame rather than on `timeupdate` (~4/s in Safari,
  // a visibly stepping bar). Stops moving whenever playback does — held,
  // buffering, or frozen.
  useEffect(() => {
    if (!playing || !active) return;
    let id = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video?.duration)
        callbacksRef.current.onProgress(video.currentTime / video.duration);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, active]);
  return (
    <div
      className={`absolute inset-0 bg-black overflow-hidden ${active ? "" : "opacity-0 pointer-events-none"}`}
    >
      <video
        ref={videoRef}
        poster={poster}
        preload="auto"
        autoPlay={active}
        muted={muted}
        playsInline
        onPlaying={() => setPlaying(true)}
        onEnded={() => active && onEnded()}
        onError={fail}
        className="absolute inset-0 w-full h-full object-contain bg-black"
      >
        {/* HEVC only. Plain type: a bare codecs="hvc1" can make Chrome skip
            HEVC it could play. Errors fire on <source>, not <video>. */}
        <source src={src} type="video/mp4" onError={fail} />
      </video>
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

/** A full-screen photo over its blurred placeholder. `onReady`: loaded, or
 * failed (so the story moves on instead of waiting forever). */
function StoryPhoto({
  media,
  onReady,
}: {
  media: StepView["media"][number];
  onReady?: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  // Already in the browser cache: `load` can fire before React attaches
  // the handler, so check on every new src too.
  useEffect(() => {
    if (imgRef.current?.complete) onReady?.();
  }, [media.displayUrl, onReady]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      onLoad={onReady}
      onError={onReady}
      src={media.displayUrl}
      alt=""
      decoding="async"
      draggable={false}
      className="w-full h-full object-contain bg-black bg-contain bg-center bg-no-repeat"
      style={
        media.placeholder
          ? { backgroundImage: `url(${media.placeholder})` }
          : undefined
      }
    />
  );
}
