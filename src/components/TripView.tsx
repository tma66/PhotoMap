"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { MapStep, MapStyleMode } from "./TripMap";
import MapOverlayHeader from "./MapOverlayHeader";
import StepCarousel, { type StepCarouselHandle } from "./StepCarousel";
import TripScrubber, { type TripScrubberHandle } from "./TripScrubber";
import StepStory from "./StepStory";
import type { TripView as TripViewData } from "@/lib/trip-view";

// maplibre-gl is a large library — loading it after the initial paint lets
// the header/carousel become interactive first instead of waiting on it.
const TripMap = dynamic(() => import("./TripMap"), { ssr: false });
const LocationPicker = dynamic(() => import("./LocationPicker"), {
  ssr: false,
});

export default function TripView({ trip }: { trip: TripViewData }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyEnterAtEnd, setStoryEnterAtEnd] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>("streets");
  const [showRoute, setShowRoute] = useState(true);
  const [storyOriginRect, setStoryOriginRect] = useState<DOMRect | null>(null);
  const scrubberRef = useRef<TripScrubberHandle>(null);
  const carouselRef = useRef<StepCarouselHandle>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const router = useRouter();

  // Stable reference across the 60fps re-renders `onScrollProgress` below
  // drives — otherwise TripMap sees a "new" `steps` array every
  // frame and its fly-to-active-step effect (keyed on them) restarts
  // constantly while the carousel is just being scrolled.
  const mapSteps: MapStep[] = useMemo(
    () =>
      trip.steps.map((s) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        transportMode: s.transportMode,
        locationName: s.locationName,
        cityName: s.cityName,
        thumbUrl: s.media[0]?.thumbUrl ?? null,
        pinUrl: s.pinUrl,
      })),
    [trip.steps],
  );

  const mapKey = useMemo(
    () =>
      mapSteps
        .map(
          (s) =>
            `${s.id}@${s.lat},${s.lng}:${s.locationName}:${s.cityName}:${s.pinUrl}`,
        )
        .join("|"),
    [mapSteps],
  );

  // Blur placeholders for every photo the page didn't inline (only the first
  // few cards' covers), fetched once the page is up.
  const [placeholders, setPlaceholders] = useState<Record<string, string>>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${trip.path}/placeholders`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : undefined))
      .then(setPlaceholders)
      .catch(() => {});
    return () => controller.abort();
  }, [trip.path]);
  const stepsWithPlaceholders = useMemo(
    () =>
      placeholders
        ? trip.steps.map((s) => ({
            ...s,
            media: s.media.map((m) => ({
              ...m,
              placeholder: m.placeholder ?? placeholders[m.hash] ?? null,
            })),
          }))
        : trip.steps,
    [trip.steps, placeholders],
  );

  // Stable, so the carousel doesn't re-attach its scroll listener on every
  // render of this page.
  const handleScrollProgress = useCallback(
    (p: number) => scrubberRef.current?.setProgress(p),
    [],
  );

  const activeStepId = trip.steps[activeIndex]?.id ?? null;

  const handleSelectStepOnMap = (id: string) => {
    const i = trip.steps.findIndex((s) => s.id === id);
    if (i >= 0) setActiveIndex(i);
  };

  return (
    <div
      data-page={trip.path}
      data-zoom-page={trip.zoomName}
      className="relative h-[100dvh] overflow-hidden bg-ps-navy"
    >
      <TripMap
        // TripMap builds its pins and route once — remount it when a saved
        // location change brings different pins.
        key={mapKey}
        steps={mapSteps}
        activeStepId={activeStepId}
        isScrubbing={isScrubbing}
        hidden={storyOpen}
        styleMode={mapStyleMode}
        showRoute={showRoute}
        onSelectStep={handleSelectStepOnMap}
      />

      <MapOverlayHeader
        title={trip.title}
        backHref={trip.backHref}
        owner={trip.owner}
        flags={trip.titleFlags}
        statsLabel={trip.statsLabel}
        mapStyleMode={mapStyleMode}
        onToggleMapStyleMode={() =>
          setMapStyleMode((m) => (m === "satellite" ? "streets" : "satellite"))
        }
        showRoute={showRoute}
        onToggleRoute={() => setShowRoute((v) => !v)}
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
          steps={stepsWithPlaceholders}
          flags={trip.flags}
          startDateLabel={trip.startDateLabel}
          endCard={trip.endCard}
          activeIndex={activeIndex}
          isScrubbing={isScrubbing}
          onActiveChange={setActiveIndex}
          onScrollProgress={handleScrollProgress}
          onEditLocation={(i) => {
            setActiveIndex(i);
            setEditingIndex(i);
          }}
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

      {editingIndex != null && trip.steps[editingIndex] && (
        <LocationPicker
          step={trip.steps[editingIndex]}
          photoCount={trip.steps[editingIndex].media.length}
          styleMode={mapStyleMode}
          onClose={() => setEditingIndex(null)}
          onSaved={() => {
            setEditingIndex(null);
            router.refresh();
          }}
        />
      )}

      {storyOpen && (
        <StepStory
          key={activeIndex}
          steps={stepsWithPlaceholders}
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
