"use client";

import { useState } from "react";
import { BackChevronIcon } from "./icons";

const PAIR_COUNT = 8;
const MATCH_DELAY_MS = 500;
const MISMATCH_DELAY_MS = 900;

interface Card {
  url: string;
  matchKey: number;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function buildDeck(photoUrls: string[]): Card[] {
  const pool = shuffled(photoUrls).slice(0, PAIR_COUNT);
  const pairs = pool.flatMap((url, matchKey) => [
    { url, matchKey },
    { url, matchKey },
  ]);
  return shuffled(pairs);
}

export default function MemoryGame({
  photoUrls,
  onClose,
}: {
  photoUrls: string[];
  onClose: () => void;
}) {
  const [deck, setDeck] = useState(() => buildDeck(photoUrls));
  // Exactly two flipped-and-unmatched cards is itself the "waiting on a
  // match/mismatch timeout" state — no separate busy flag needed to track it.
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());

  const won = matched.size === deck.length;

  function handleCardClick(index: number) {
    if (flipped.length === 2 || flipped.includes(index) || matched.has(index))
      return;

    if (flipped.length === 0) {
      setFlipped([index]);
      return;
    }

    const firstIndex = flipped[0]!;
    setFlipped([firstIndex, index]);

    if (deck[firstIndex]!.matchKey === deck[index]!.matchKey) {
      setTimeout(() => {
        setMatched((prev) => new Set(prev).add(firstIndex).add(index));
        setFlipped([]);
      }, MATCH_DELAY_MS);
    } else {
      setTimeout(() => {
        setFlipped([]);
      }, MISMATCH_DELAY_MS);
    }
  }

  function playAgain() {
    setDeck(buildDeck(photoUrls));
    setFlipped([]);
    setMatched(new Set());
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ps-navy overflow-hidden"
      style={{ maxWidth: 480, margin: "0 auto" }}
    >
      <div className="absolute top-0 inset-x-0 z-20 px-4 safe-top flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-12 h-12 rounded-full glass-button flex items-center justify-center shadow-soft"
        >
          <BackChevronIcon size={28} />
        </button>
        <p
          className="text-white font-bold text-lg"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}
        >
          Memory Match
        </p>
        <div className="w-12 h-12" aria-hidden="true" />
      </div>

      <div className="h-full flex flex-col items-center justify-center px-4 pt-20 pb-8">
        <div className="grid grid-cols-4 gap-2.5 w-full max-w-[420px]">
          {deck.map((card, index) => (
            <MemoryCard
              key={index}
              card={card}
              flipped={flipped.includes(index) || matched.has(index)}
              matched={matched.has(index)}
              onClick={() => handleCardClick(index)}
            />
          ))}
        </div>

        {won && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-white font-bold text-lg">
              You matched them all! 🐢
            </p>
            <button
              type="button"
              onClick={playAgain}
              className="px-5 py-2.5 rounded-full bg-white text-ps-navy-text font-semibold text-sm shadow-soft active:scale-[0.98] transition-transform"
            >
              Play again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryCard({
  card,
  flipped,
  matched,
  onClick,
}: {
  card: Card;
  flipped: boolean;
  matched: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={flipped ? "Photo card, revealed" : "Face-down card"}
      className="aspect-square rounded-xl shadow-soft"
      style={{ perspective: 600 }}
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.4s cubic-bezier(0.32, 0.72, 0.35, 1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div
          className="absolute inset-0 rounded-xl overflow-hidden bg-ps-bg flex items-center justify-center"
          style={{ backfaceVisibility: "hidden" }}
        >
          <TurtleBack />
        </div>
        <div
          className={`absolute inset-0 rounded-xl overflow-hidden ${
            matched ? "ring-2 ring-ps-link" : ""
          }`}
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.url}
            alt=""
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      </div>
    </button>
  );
}

// A simple cartoon sea turtle for every card's face-down side — no photo
// content, so a card gives nothing away until it's flipped.
function TurtleBack() {
  return (
    <svg width="70%" height="70%" viewBox="0 0 64 64" fill="none">
      <ellipse cx="32" cy="36" rx="20" ry="16" fill="#3F8F5F" />
      <path d="M32 22 L44 30 L40 44 L24 44 L20 30 Z" fill="#2E6B47" />
      <circle cx="32" cy="30" r="3.2" fill="#2E6B47" />
      <circle cx="24" cy="38" r="3.2" fill="#2E6B47" />
      <circle cx="40" cy="38" r="3.2" fill="#2E6B47" />
      <ellipse cx="32" cy="16" rx="7" ry="6" fill="#E8B25E" />
      <circle cx="29.3" cy="15" r="1.4" fill="#00293D" />
      <circle cx="34.7" cy="15" r="1.4" fill="#00293D" />
      <ellipse
        cx="12"
        cy="26"
        rx="6"
        ry="4"
        fill="#E8B25E"
        transform="rotate(-25 12 26)"
      />
      <ellipse
        cx="52"
        cy="26"
        rx="6"
        ry="4"
        fill="#E8B25E"
        transform="rotate(25 52 26)"
      />
      <ellipse
        cx="16"
        cy="50"
        rx="5.5"
        ry="4"
        fill="#E8B25E"
        transform="rotate(20 16 50)"
      />
      <ellipse
        cx="48"
        cy="50"
        rx="5.5"
        ry="4"
        fill="#E8B25E"
        transform="rotate(-20 48 50)"
      />
    </svg>
  );
}
