"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Drawer } from "vaul";
import type { HomeData } from "@/lib/home-view";

// maplibre-gl is a large library — loading it after the initial paint lets
// the sheet/drawer become interactive first instead of waiting on it.
const GlobeMap = dynamic(() => import("./GlobeMap"), { ssr: false });

// A fixed pixel height (rather than a fraction of the drawer) so the
// peeked drawer reliably reveals the profile row and the
// Trips/Countries/Cities stats grid without a drag. The globe gets the same
// value as its bottom padding so it recenters in the space this leaves
// visible above the drawer, instead of staying centered on the full screen
// height and leaving empty sky above it.
const PEEK_HEIGHT_PX = 380;
const SNAP_PEEK = `${PEEK_HEIGHT_PX}px`;
const SNAP_FULL = 1;

export default function HomeView({ data }: { data: HomeData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"trips" | "stats">("trips");
  const [snap, setSnap] = useState<number | string | null>(SNAP_PEEK);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[#04101c]">
      <GlobeMap
        steps={data.globeSteps}
        bottomInset={PEEK_HEIGHT_PX}
        paused={snap === SNAP_FULL}
        onSelectStep={(tripId) => router.push(`/m/${tripId}`)}
      />

      <Drawer.Root
        open
        dismissible={false}
        modal={false}
        snapPoints={[SNAP_PEEK, SNAP_FULL]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <Drawer.Portal>
          <Drawer.Content className="fixed bottom-0 inset-x-2 z-30 mx-auto max-w-[480px] bg-ps-bg/95 rounded-t-3xl h-full max-h-[92%] flex flex-col outline-none shadow-soft">
            <Drawer.Title className="sr-only">Profile</Drawer.Title>
            <Drawer.Handle
              className="mt-2"
              style={{ backgroundColor: "#9AA5B1" }}
            />

            <div
              className={`px-5 pt-3 pb-2 no-scrollbar ${
                snap === SNAP_FULL ? "overflow-y-auto" : "overflow-hidden"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="relative">
                  {data.profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.profile.avatarUrl}
                      alt=""
                      decoding="async"
                      className="w-20 h-20 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-ps-navy" />
                  )}
                </div>
                <div>
                  <p className="font-bold text-2xl">{data.profile.name}</p>
                  {data.profile.bio && (
                    <p className="text-sm text-ps-muted-2 mt-0.5">
                      {data.profile.bio}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 text-center mt-4 border-y border-ps-border/60 py-2.5">
                <Stat label="Trips" value={data.stats.totalTrips} />
                <Stat label="Countries" value={data.stats.countries} />
                <Stat label="Cities" value={data.stats.totalCities} />
              </div>

              <div className="flex mt-3 bg-black/5 rounded-full p-1 text-sm font-semibold">
                {(["trips", "stats"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`flex-1 py-1.5 rounded-full transition-colors ${
                      tab === t
                        ? "bg-white text-ps-navy-text shadow-soft"
                        : "text-ps-muted-2"
                    }`}
                  >
                    {t === "trips" ? "Trips" : "Statistics"}
                  </button>
                ))}
              </div>

              {tab === "trips" ? (
                <div className="mt-3 flex flex-col gap-3 pb-8">
                  {data.tripCards.length === 0 && (
                    <p className="text-sm text-ps-muted-2 py-6 text-center">
                      Drop photos into a folder under <code>assets/</code> and
                      run the ingest script to see a trip here.
                    </p>
                  )}
                  {data.tripCards.length > 0 && (
                    <p className="font-bold text-base">Past trips</p>
                  )}
                  {data.tripCards.map((trip) => (
                    <Link
                      key={trip.slug}
                      href={`/m/${trip.slug}`}
                      className="relative rounded-2xl aspect-[16/10] block shadow-soft transition-transform active:scale-[0.98]"
                    >
                      {/* overflow-hidden lives on this inner wrapper, not
                          the link itself — box-shadow on the same box as
                          overflow-hidden gets clipped away by the browser. */}
                      <div className="absolute inset-0 rounded-2xl overflow-hidden">
                        {trip.coverUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={trip.coverUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                        <div className="absolute bottom-2.5 left-3 right-3">
                          <p className="text-white font-bold text-lg leading-tight">
                            {trip.title}
                          </p>
                          <p className="text-white/80 text-[11px] font-medium mt-0.5">
                            {trip.subtitleLabel}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-4 pb-8">
                  <p className="text-sm font-semibold text-ps-muted mb-2">
                    You&apos;ve seen
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-ps-navy text-white p-4 h-28 flex flex-col justify-center shadow-soft">
                      <p className="text-2xl font-bold">
                        {data.stats.countries}
                      </p>
                      <p className="text-xs opacity-80">countries</p>
                    </div>
                    <div className="rounded-2xl bg-[#0b2a4a] text-white p-4 h-28 flex flex-col justify-center shadow-soft">
                      <p className="text-2xl font-bold">
                        {data.stats.percentOfWorld}%
                      </p>
                      <p className="text-xs opacity-80">of the world</p>
                    </div>
                  </div>

                  <p className="text-sm font-semibold text-ps-muted mt-5 mb-2">
                    Countries visited
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.stats.countryFlags.length === 0 && (
                      <span className="text-sm text-ps-muted-2">None yet</span>
                    )}
                    {data.stats.countryFlags.map((flag) => (
                      <span
                        key={flag}
                        className="bg-white rounded-full px-3 py-1 text-base shadow-soft"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-5 text-sm">
                    <div className="bg-white rounded-xl p-3 shadow-soft">
                      <p className="text-ps-muted-2 text-xs">Distance</p>
                      <p className="font-bold">{data.stats.totalKmLabel}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-soft">
                      <p className="text-ps-muted-2 text-xs">Days</p>
                      <p className="font-bold">{data.stats.totalDays}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 shadow-soft">
                      <p className="text-ps-muted-2 text-xs">Cities</p>
                      <p className="font-bold">{data.stats.totalCities}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-bold text-base">{value}</p>
      <p className="text-[11px] text-ps-muted-2">{label}</p>
    </div>
  );
}
