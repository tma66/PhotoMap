"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
} from "react";
import type { StepView, TripView } from "@/lib/trip-view";
import { formatBookendDate } from "@/lib/format";
import { EditLocationIcon } from "./icons";

export interface StepCarouselHandle {
  /** The on-screen rect of a step's card, or null if it's not currently
   * rendered — used to animate the story view open/closed from/to the
   * card's position (see TripView.tsx). */
  getCardRect: (stepId: string) => DOMRect | null;
}

// Today's date in the visitor's own timezone, formatted like the other
// bookend dates (which are naive local dates stored as UTC). Read on the
// client only: pages are prerendered, so a server-rendered date would go stale.
function todayLabel(): string {
  const now = new Date();
  return formatBookendDate(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}
const noSubscribe = () => () => {};

/** scrollLeft that puts `card` centered in `container`'s viewport. */
function centeredScrollLeft(container: HTMLElement, card: HTMLElement): number {
  return card.offsetLeft - (container.clientWidth - card.clientWidth) / 2;
}

interface StepCarouselProps {
  steps: StepView[];
  flags: string[];
  startDateLabel: string;
  endCard: TripView["endCard"];
  activeIndex: number;
  isScrubbing?: boolean;
  onActiveChange: (index: number) => void;
  onScrollProgress: (progress: number) => void;
  onOpenStep: (index: number) => void;
  onEditLocation: (index: number) => void;
}

const StepCarousel = forwardRef<StepCarouselHandle, StepCarouselProps>(
  function StepCarousel(
    {
      steps,
      flags,
      startDateLabel,
      endCard,
      activeIndex,
      isScrubbing = false,
      onActiveChange,
      onScrollProgress,
      onOpenStep,
      onEditLocation,
    },
    ref,
  ) {
    const today = useSyncExternalStore(noSubscribe, todayLabel, () => "");
    const scrollRef = useRef<HTMLDivElement>(null);
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
    const suppressScrollReport = useRef(false);
    const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // True for one effect run right after the carousel's own scroll handler
    // (below) changed activeIndex — as opposed to an external trigger (map pin,
    // day scrubber, story nav). Skipping the recenter in that case matters:
    // while the visitor is still actively dragging, scrollLeft isn't at the
    // settled target yet, and calling scrollTo here would fight the live
    // touch/scroll gesture (the classic "jerks back and forth" stutter).
    // CSS scroll-snap already settles the container on its own once they let go.
    const scrollOriginatedIndexChange = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        getCardRect: (stepId: string) => {
          const i = steps.findIndex((s) => s.id === stepId);
          const card = i >= 0 ? cardRefs.current[i] : null;
          return card ? card.getBoundingClientRect() : null;
        },
      }),
      [steps],
    );

    // Snap to the active card when it changed for a reason OTHER than the
    // visitor's own scroll (e.g. tapping a map pin, dragging the day scrubber).
    useEffect(() => {
      if (scrollOriginatedIndexChange.current) {
        scrollOriginatedIndexChange.current = false;
        return;
      }
      const card = cardRefs.current[activeIndex];
      const container = scrollRef.current;
      if (!card || !container) return;

      const targetLeft = centeredScrollLeft(container, card);
      if (Math.abs(container.scrollLeft - targetLeft) > 4) {
        suppressScrollReport.current = true;
        container.scrollTo({
          left: targetLeft,
          behavior: isScrubbing ? "auto" : "smooth",
        });
        if (suppressTimerRef.current != null) {
          clearTimeout(suppressTimerRef.current);
        }
        suppressTimerRef.current = setTimeout(() => {
          suppressScrollReport.current = false;
          suppressTimerRef.current = null;
        }, 500);
      }
    }, [activeIndex, isScrubbing]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;
      let raf = 0;

      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          // Continuous position between the first and last real step, so the
          // day scrubber's fill bar slides in step with the scroll instead of
          // jumping only when the nearest card changes. Reported regardless of
          // the suppress/isScrubbing gates below (which only guard against
          // active-index feedback loops) so it also tracks a programmatic
          // recenter, e.g. after tapping a map pin.
          const first = cardRefs.current[0];
          const last = cardRefs.current[cardRefs.current.length - 1];
          if (first && last) {
            const firstTarget = centeredScrollLeft(container, first);
            const lastTarget = centeredScrollLeft(container, last);
            const span = lastTarget - firstTarget;
            const progress =
              span > 0
                ? Math.min(
                    1,
                    Math.max(0, (container.scrollLeft - firstTarget) / span),
                  )
                : 0;
            onScrollProgress(progress);
          }

          if (suppressScrollReport.current || isScrubbing) return;
          const center = container.scrollLeft + container.clientWidth / 2;
          let best = 0;
          let bestDist = Infinity;
          cardRefs.current.forEach((card, i) => {
            if (!card) return;
            const cardCenter = card.offsetLeft + card.clientWidth / 2;
            const dist = Math.abs(cardCenter - center);
            if (dist < bestDist) {
              bestDist = dist;
              best = i;
            }
          });
          if (best !== activeIndex) {
            scrollOriginatedIndexChange.current = true;
            onActiveChange(best);
          }
        });
      };

      container.addEventListener("scroll", onScroll, { passive: true });
      return () => container.removeEventListener("scroll", onScroll);
    }, [activeIndex, isScrubbing, onActiveChange, onScrollProgress]);

    return (
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto no-scrollbar px-[9%] pb-1 snap-x snap-mandatory"
      >
        <BookendCard
          icon="home"
          label="Trip started"
          dateLabel={startDateLabel}
          flags={flags}
        />

        {steps.map((step, i) => {
          const cover = step.media[0];

          return (
            <div
              key={step.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className="relative shrink-0 w-[82%] aspect-[5/4] snap-center"
            >
              <button
                type="button"
                onClick={() => onOpenStep(i)}
                className="absolute inset-0 rounded-3xl text-left shadow-soft transition-transform active:scale-[0.98]"
              >
                {/* overflow-hidden lives on this inner wrapper, not the
                  button itself — box-shadow on the same box as
                  overflow-hidden gets clipped away by the browser. */}
                <div className="absolute inset-0 rounded-3xl overflow-hidden border border-white/15">
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover.thumbUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover bg-cover"
                      style={{ backgroundImage: `url(${cover.placeholder})` }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                  <span className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-white/90 shadow-soft flex items-center justify-center text-sm">
                    {step.flag}
                  </span>
                  {step.media.length > 1 && (
                    <span className="absolute top-2.5 right-2.5 bg-black/50 text-white text-[11px] font-semibold px-2 py-1 rounded-full">
                      📷 {step.media.length}
                    </span>
                  )}

                  <div className="absolute bottom-3 left-3 right-14">
                    <p className="text-white font-bold text-base leading-tight drop-shadow">
                      {step.title}
                    </p>
                    <p className="text-white/85 text-xs mt-0.5">
                      {step.countryName}
                    </p>
                  </div>
                </div>
              </button>
              {/* A sibling of the card's button, not inside it (no nested
                  buttons). Opens LocationPicker — see TripView.tsx. */}
              <button
                type="button"
                onClick={() => onEditLocation(i)}
                aria-label="Change location"
                className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full bg-white/90 shadow-soft flex items-center justify-center active:scale-95"
              >
                <EditLocationIcon size={18} />
              </button>
            </div>
          );
        })}

        <BookendCard
          icon="flag"
          label={endCard.label}
          dateLabel={endCard.dateLabel ?? today}
          flags={endCard.flags}
        />
      </div>
    );
  },
);

export default StepCarousel;

function BookendCard({
  icon,
  label,
  dateLabel,
  flags,
}: {
  icon: "home" | "flag";
  label: string;
  dateLabel: string;
  flags: string[];
}) {
  return (
    <div className="relative shrink-0 w-[82%] aspect-[5/4] rounded-3xl snap-center border border-white/15 bg-ps-navy flex flex-col items-center justify-center text-center px-4 shadow-soft">
      <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#00293D"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon === "home" ? (
            <>
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </>
          ) : (
            <>
              <path d="M5 3v18" />
              <path d="M5 4h13l-3 4 3 4H5" />
            </>
          )}
        </svg>
      </div>
      <p className="text-white font-bold text-sm mt-2">{label}</p>
      <p className="text-white/70 text-xs mt-1">{dateLabel}</p>
      {flags.length > 0 && <p className="text-base mt-2">{flags.join(" ")}</p>}
    </div>
  );
}
