"use client";

import Link from "next/link";

interface MapOverlayHeaderProps {
  title: string;
  flags: string[];
  ownerName: string;
  ownerAvatarUrl: string | null;
  statsLabel: string;
  onShare: () => void;
}

export default function MapOverlayHeader({
  title,
  flags,
  ownerName,
  ownerAvatarUrl,
  statsLabel,
  onShare,
}: MapOverlayHeaderProps) {
  return (
    <div className="absolute top-0 inset-x-0 z-20 safe-top px-4 pointer-events-none">
      <div className="flex items-center justify-between pointer-events-auto">
        <Link
          href="/"
          aria-label="Back"
          className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18l-6-6 6-6"
              stroke="#00293D"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        <button
          type="button"
          onClick={onShare}
          aria-label="Trip menu"
          className="w-10 h-10 rounded-xl bg-ps-navy flex items-center justify-center shadow"
        >
          <svg width="18" height="14" viewBox="0 0 24 18" fill="none">
            <path d="M0 1h24M0 9h24M0 17h24" stroke="#fff" strokeWidth="2" />
          </svg>
        </button>
      </div>

      <div
        className="mt-1 text-center pointer-events-none"
        style={{ textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center justify-center gap-1.5 text-white/90 text-xs font-medium">
          {ownerAvatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ownerAvatarUrl}
              alt=""
              className="w-4 h-4 rounded-full object-cover"
            />
          )}
          <span>{ownerName}</span>
        </div>
        <h1 className="text-white font-bold text-xl leading-tight">
          {title} <span className="align-middle">{flags.join(" ")}</span>
        </h1>
      </div>

      <div className="mt-2 flex justify-start pointer-events-none">
        <span className="bg-black/55 text-white text-[11px] font-medium px-3 py-1.5 rounded-full">
          {statsLabel}
        </span>
      </div>
    </div>
  );
}
