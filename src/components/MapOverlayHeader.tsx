"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { onPlainClick, navigateBack } from "@/lib/page-transition";
import { BackChevronIcon } from "./icons";

interface MapOverlayHeaderProps {
  title: string;
  backHref: string;
  owner: { name: string; avatarUrl: string | null };
  flags: string[];
  statsLabel: string;
  mapStyleMode: "satellite" | "streets";
  onToggleMapStyleMode: () => void;
  showRoute: boolean;
  onToggleRoute: () => void;
}

export default function MapOverlayHeader({
  title,
  backHref,
  owner,
  flags,
  statsLabel,
  mapStyleMode,
  onToggleMapStyleMode,
  showRoute,
  onToggleRoute,
}: MapOverlayHeaderProps) {
  const router = useRouter();
  return (
    <div className="absolute top-0 inset-x-0 z-20 safe-top px-4 pointer-events-none">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {owner.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={owner.avatarUrl}
            alt=""
            decoding="async"
            className="w-5 h-5 rounded-full object-cover"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-white/30" />
        )}
        <span
          className="text-white/90 text-xs font-semibold"
          style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
        >
          {owner.name}
        </span>
      </div>

      <div className="relative flex items-center justify-center">
        <Link
          href={backHref}
          aria-label="Back"
          onClick={(e) =>
            onPlainClick(e, (el) =>
              navigateBack(el, backHref, "zoom", router.push),
            )
          }
          className="absolute left-0 top-0 w-12 h-12 rounded-full map-icon-button flex items-center justify-center shadow-soft pointer-events-auto"
        >
          <BackChevronIcon size={28} color="#ffffff" />
        </Link>

        <div className="absolute right-0 top-0 flex flex-col items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={onToggleMapStyleMode}
            aria-label={
              mapStyleMode === "satellite"
                ? "Switch to streets view"
                : "Switch to satellite view"
            }
            className="w-12 h-12 rounded-full map-icon-button flex items-center justify-center shadow-soft"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onToggleRoute}
            aria-label={showRoute ? "Hide route lines" : "Show route lines"}
            aria-pressed={showRoute}
            className="w-12 h-12 rounded-full map-icon-button flex items-center justify-center shadow-soft"
          >
            {/* A dashed route between two stops, struck through while hidden. */}
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="19" r="2.5" />
              <circle cx="18" cy="5" r="2.5" />
              <path
                d="M8.5 19h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h8"
                strokeDasharray="2.5 2.5"
              />
              {!showRoute && <line x1="3" y1="3" x2="21" y2="21" />}
            </svg>
          </button>
        </div>

        <h1
          className="text-white font-bold text-xl leading-tight text-center pointer-events-none px-12"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}
        >
          {title} <span className="align-middle">{flags.join(" ")}</span>
        </h1>
      </div>

      <div className="mt-2 flex justify-center pointer-events-none">
        <span className="bg-[rgba(74,74,79,0.55)] text-white text-[11px] font-medium px-3 py-1.5 rounded-full">
          {statsLabel}
        </span>
      </div>
    </div>
  );
}
