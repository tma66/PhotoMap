"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Drawer } from "vaul";
import GlobeMap from "./GlobeMap";
import type { HomeData } from "@/lib/home-view";

// Fractions of the drawer's own max height so this scales across phone
// sizes rather than assuming one screen height.
const SNAP_PEEK = 0.32;
const SNAP_FULL = 1;

export default function HomeView({ data }: { data: HomeData }) {
  const router = useRouter();
  const [tab, setTab] = useState<"trips" | "stats">("trips");
  const [snap, setSnap] = useState<number | string | null>(SNAP_PEEK);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[#04101c]">
      <GlobeMap
        steps={data.globeSteps}
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
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-30 mx-auto max-w-[480px] bg-ps-bg rounded-t-2xl h-full max-h-[92%] flex flex-col outline-none">
            <Drawer.Title className="sr-only">Profile</Drawer.Title>
            <Drawer.Handle className="mt-2" />

            <div className="px-5 pt-3 pb-2 overflow-y-auto no-scrollbar">
              <div className="flex items-center gap-3">
                <div className="relative">
                  {data.profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.profile.avatarUrl}
                      alt=""
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-ps-navy" />
                  )}
                  <span className="absolute -top-1 -right-1 bg-ps-accent text-white text-[10px] font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-ps-bg">
                    {data.profile.countryCount}
                  </span>
                </div>
                <div>
                  <p className="font-bold text-base">{data.profile.name}</p>
                  {data.profile.bio && (
                    <p className="text-xs text-ps-muted-2 mt-0.5">
                      {data.profile.bio}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 text-center mt-4 border-y border-ps-border/60 py-2.5">
                <Stat label="Countries" value={data.stats.countries} />
                <Stat label="Trips" value={data.stats.totalTrips} />
                <Stat label="Steps" value={data.stats.totalSteps} />
              </div>

              <div className="flex mt-3 text-sm font-semibold">
                {(["trips", "stats"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`flex-1 pb-2 border-b-2 ${tab === t ? "border-ps-navy text-ps-navy-text" : "border-transparent text-ps-muted-2"}`}
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
                      className="relative rounded-2xl overflow-hidden aspect-[16/10] block"
                    >
                      {trip.coverUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={trip.coverUrl}
                          alt=""
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
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-4 pb-8">
                  <p className="text-sm font-semibold text-ps-muted mb-2">
                    You&apos;ve seen
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-ps-navy text-white p-4 h-28 flex flex-col justify-end">
                      <p className="text-2xl font-bold">
                        {data.stats.countries}
                      </p>
                      <p className="text-xs opacity-80">countries</p>
                      <p className="text-lg mt-1">
                        {data.stats.countryFlags.slice(0, 6).join(" ")}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#0b2a4a] text-white p-4 h-28 flex flex-col justify-end">
                      <p className="text-2xl font-bold">
                        {data.stats.percentOfWorld}%
                      </p>
                      <p className="text-xs opacity-80">of the world</p>
                    </div>
                  </div>

                  <p className="text-sm font-semibold text-ps-muted mt-5 mb-2">
                    Continents visited
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.stats.continents.length === 0 && (
                      <span className="text-sm text-ps-muted-2">None yet</span>
                    )}
                    {data.stats.continents.map((c) => (
                      <span
                        key={c}
                        className="bg-white rounded-full px-3 py-1 text-xs font-medium shadow-sm"
                      >
                        {c}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-5 text-sm">
                    <div className="bg-white rounded-xl p-3">
                      <p className="text-ps-muted-2 text-xs">Distance</p>
                      <p className="font-bold">{data.stats.totalKmLabel}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3">
                      <p className="text-ps-muted-2 text-xs">Days</p>
                      <p className="font-bold">{data.stats.totalDays}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3">
                      <p className="text-ps-muted-2 text-xs">Steps</p>
                      <p className="font-bold">{data.stats.totalSteps}</p>
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
