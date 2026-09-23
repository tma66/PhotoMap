"use client";

import { useEffect, useRef } from "react";
import type { StepView } from "@/lib/trip-view";

interface StepCarouselProps {
  steps: StepView[];
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onOpenStep: (index: number) => void;
}

export default function StepCarousel({
  steps,
  activeIndex,
  onActiveChange,
  onOpenStep,
}: StepCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const suppressScrollReport = useRef(false);

  // Snap to the active card when it changed for a reason OTHER than the
  // visitor's own scroll (e.g. tapping a map pin).
  useEffect(() => {
    const card = cardRefs.current[activeIndex];
    const container = scrollRef.current;
    if (!card || !container) return;

    const targetLeft =
      card.offsetLeft - (container.clientWidth - card.clientWidth) / 2;
    if (Math.abs(container.scrollLeft - targetLeft) > 4) {
      suppressScrollReport.current = true;
      container.scrollTo({ left: targetLeft, behavior: "smooth" });
      window.setTimeout(() => (suppressScrollReport.current = false), 500);
    }
  }, [activeIndex]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let raf = 0;

    const onScroll = () => {
      if (suppressScrollReport.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
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
        if (best !== activeIndex) onActiveChange(best);
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [activeIndex, onActiveChange]);

  const dayNumber = steps[activeIndex]?.dayNumber ?? 1;

  return (
    <div>
      <div className="flex justify-center -mt-3 mb-2 relative z-10">
        <span className="bg-ps-link text-white text-xs font-semibold px-3 py-1 rounded-full shadow">
          DAY {dayNumber}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto no-scrollbar px-[12.5%] pb-1 snap-x snap-mandatory"
      >
        {steps.map((step, i) => {
          const cover = step.media[0];
          const photoCount = step.media.filter(
            (m) => m.type === "IMAGE",
          ).length;
          const videoCount = step.media.filter(
            (m) => m.type === "VIDEO",
          ).length;

          return (
            <button
              key={step.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              type="button"
              onClick={() => onOpenStep(i)}
              className="relative shrink-0 w-[75%] aspect-[4/5] rounded-2xl overflow-hidden snap-center text-left"
            >
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover.thumbUrl}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover bg-cover"
                  style={{ backgroundImage: `url(${cover.placeholder})` }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

              {step.isLatest && (
                <span className="absolute top-2 left-2 bg-ps-accent text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  New
                </span>
              )}

              <div className="absolute bottom-9 left-3 right-3">
                <p className="text-white font-bold text-base leading-tight drop-shadow">
                  {step.title}
                </p>
                <p className="text-white/85 text-xs mt-0.5">
                  {step.flag} {step.countryName}
                </p>
              </div>

              <div className="absolute bottom-0 inset-x-0 bg-white/95 px-3 py-1.5 flex items-center gap-3 text-[11px] text-ps-muted font-medium">
                <span>📷 {photoCount}</span>
                {videoCount > 0 && <span>🎬 {videoCount}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
