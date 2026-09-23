"use client";

import { useState } from "react";
import TripMap, { type MapStep } from "./TripMap";
import MapOverlayHeader from "./MapOverlayHeader";
import StepCarousel from "./StepCarousel";
import StepStory from "./StepStory";
import type { TripView as TripViewData } from "@/lib/trip-view";

export default function TripView({ trip }: { trip: TripViewData }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyEnterAtEnd, setStoryEnterAtEnd] = useState(false);

  const mapSteps: MapStep[] = trip.steps.map((s) => ({
    id: s.id,
    lat: s.lat,
    lng: s.lng,
    arrivedAt: new Date(s.arrivedAtISO),
    transportMode: s.transportMode,
    thumbUrl: s.media[0]?.thumbUrl ?? null,
  }));

  const trackPoints = trip.trackPoints.map((p) => ({
    t: new Date(p.tISO),
    lat: p.lat,
    lng: p.lng,
  }));

  const activeStepId = trip.steps[activeIndex]?.id ?? null;

  const handleSelectStepOnMap = (id: string) => {
    const i = trip.steps.findIndex((s) => s.id === id);
    if (i >= 0) setActiveIndex(i);
  };

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.title, url });
      } catch {
        // visitor cancelled the native share sheet — nothing to do
      }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  };

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-ps-navy">
      <TripMap
        steps={mapSteps}
        trackPoints={trackPoints}
        activeStepId={activeStepId}
        onSelectStep={handleSelectStepOnMap}
      />

      <MapOverlayHeader
        title={trip.title}
        flags={trip.flags}
        ownerName={trip.ownerName}
        ownerAvatarUrl={trip.ownerAvatarUrl}
        statsLabel={trip.statsLabel}
        onShare={handleShare}
      />

      <div className="absolute bottom-0 inset-x-0 z-20 safe-bottom pt-3">
        <StepCarousel
          steps={trip.steps}
          activeIndex={activeIndex}
          onActiveChange={setActiveIndex}
          onOpenStep={(i) => {
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
