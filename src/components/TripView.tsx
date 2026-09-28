"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MapStep, MapStyleMode } from "./TripMap";
import MapOverlayHeader from "./MapOverlayHeader";
import StepCarousel, { type StepCarouselHandle } from "./StepCarousel";
import TripScrubber, { type TripScrubberHandle } from "./TripScrubber";
import StepStory from "./StepStory";
import type { TripView as TripViewData } from "@/lib/trip-view";

// maplibre-gl is a large library — loading it after the initial paint lets
// the header/carousel become interactive first instead of waiting on it.
const TripMap = dynamic(() => import("./TripMap"), { ssr: false });

export default function TripView({ trip }: { trip: TripViewData }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyEnterAtEnd, setStoryEnterAtEnd] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>("streets");
  const [storyOriginRect, setStoryOriginRect] = useState<DOMRect | null>(null);
  const scrubberRef = useRef<TripScrubberHandle>(null);
  const carouselRef = useRef<StepCarouselHandle>(null);

  // Stable references across the 60fps re-renders `onScrollProgress` below
  // drives — otherwise TripMap sees a "new" `steps`/`trackPoints` array every
  // frame and its fly-to-active-step effect (keyed on them) restarts
  // constantly while the carousel is just being scrolled.
  const mapSteps: MapStep[] = useMemo(
    () =>
      trip.steps.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        arrivedAt: new Date(s.arrivedAtISO),
        transportMode: s.transportMode,
        locationName: s.locationName,
        thumbUrl: s.media[0]?.thumbUrl ?? null,
      })),
    [trip.steps],
  );

  const trackPoints = useMemo(
    () =>
      trip.trackPoints.map((p) => ({
        t: new Date(p.tISO),
        lat: p.lat,
        lng: p.lng,
      })),
    [trip.trackPoints],
  );

  const activeStepId = trip.steps[activeIndex]?.id ?? null;

  const handleSelectStepOnMap = (id: string) => {
    const i = trip.steps.findIndex((s) => s.id === id);
    if (i >= 0) setActiveIndex(i);
  };

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-ps-navy">
      <TripMap
        steps={mapSteps}
        trackPoints={trackPoints}
        activeStepId={activeStepId}
        isScrubbing={isScrubbing}
        styleMode={mapStyleMode}
        onSelectStep={handleSelectStepOnMap}
      />

      <MapOverlayHeader
        title={trip.title}
        owner={trip.owner}
        flags={trip.flags}
        statsLabel={trip.statsLabel}
        mapStyleMode={mapStyleMode}
        onToggleMapStyleMode={() =>
          setMapStyleMode((m) => (m === "satellite" ? "streets" : "satellite"))
        }
      />

      <div className="absolute bottom-0 inset-x-0 z-20 pt-3 safe-bottom">
        <TripScrubber
          ref={scrubberRef}
          dayNumbers={trip.steps.map((s) => s.dayNumber)}
          activeIndex={activeIndex}
          onChange={setActiveIndex}
          onScrubStart={() => setIsScrubbing(true)}
          onScrubEnd={() => setIsScrubbing(false)}
        />
        <StepCarousel
          ref={carouselRef}
          steps={trip.steps}
          flags={trip.flags}
          startDateLabel={trip.startDateLabel}
          endDateLabel={trip.endDateLabel}
          activeIndex={activeIndex}
          isScrubbing={isScrubbing}
          onActiveChange={setActiveIndex}
          onScrollProgress={(p) => scrubberRef.current?.setProgress(p)}
          onOpenStep={(i) => {
            const step = trip.steps[i];
            setStoryOriginRect(
              step ? (carouselRef.current?.getCardRect(step.id) ?? null) : null,
            );
            setActiveIndex(i);
            setStoryEnterAtEnd(false);
            setStoryOpen(true);
          }}
        />
      </div>

      {storyOpen && (
        <StepStory
          key={activeIndex}
          steps={trip.steps}
          stepIndex={activeIndex}
          initialMediaIndex={
            storyEnterAtEnd
              ? Math.max(0, (trip.steps[activeIndex]?.media.length ?? 1) - 1)
              : 0
          }
          originRect={storyOriginRect}
          onOriginConsumed={() => setStoryOriginRect(null)}
          getCardRect={(stepId) =>
            carouselRef.current?.getCardRect(stepId) ?? null
          }
          onClose={() => setStoryOpen(false)}
          onStepIndexChange={(i, enterAtEnd) => {
            setStoryEnterAtEnd(Boolean(enterAtEnd));
            setActiveIndex(i);
          }}
        />
      )}
    </div>
  );
}
