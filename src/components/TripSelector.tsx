"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackChevronIcon } from "./icons";
import type { TripSelectorData } from "@/lib/trip-view";
import {
  navigateBack,
  navigateForward,
  onPlainClick,
} from "@/lib/page-transition";

/** Picks one trip out of a folder that holds several (/m/<slug>). Tiles
 * reuse the trip page's step-card look (StepCarousel.tsx). */
export default function TripSelector({ data }: { data: TripSelectorData }) {
  const router = useRouter();
  return (
    <div
      data-page={data.path}
      className="h-[100dvh] overflow-y-auto no-scrollbar bg-ps-bg safe-top px-4 pb-8"
    >
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {data.owner.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.owner.avatarUrl}
            alt=""
            decoding="async"
            className="w-5 h-5 rounded-full object-cover"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-ps-border" />
        )}
        <span className="text-ps-muted text-xs font-semibold">
          {data.owner.name}
        </span>
      </div>

      <div className="relative flex items-center justify-center h-12">
        <Link
          href="/"
          aria-label="Back"
          onClick={(e) =>
            onPlainClick(e, (el) => navigateBack(el, "/", "pop", router.push))
          }
          className="absolute left-0 top-0 w-12 h-12 rounded-full map-icon-button flex items-center justify-center shadow-soft"
        >
          <BackChevronIcon size={28} color="#ffffff" />
        </Link>
        <h1 className="text-ps-navy-text font-bold text-xl leading-tight text-center px-12">
          {data.title}
        </h1>
      </div>

      <div className="mt-4 flex flex-col gap-3 max-w-[480px] mx-auto">
        {data.tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            data-zoom-tile={tile.zoomName}
            onClick={(e) =>
              onPlainClick(e, (el) =>
                navigateForward(el, tile.href, "zoom", router.push),
              )
            }
            className="relative block aspect-[5/4] rounded-3xl shadow-soft transition-transform active:scale-[0.98]"
          >
            {/* overflow-hidden on the inner wrapper, not the link — box-shadow
                on the same box as overflow-hidden gets clipped away. */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden border border-white/15">
              {tile.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tile.coverUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3">
                <p className="text-white font-bold text-lg leading-tight drop-shadow">
                  {tile.title}
                </p>
                <p className="text-white/85 text-xs font-medium mt-0.5">
                  {tile.subtitleLabel}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
