// iOS-style page transitions, driven by a manual view transition around
// the route change (styles: "Page transitions" in globals.css):
//
// - push / pop — moving down/up the hierarchy (home ↔ trip selector): the
//   new page slides in from the right over the old one, which shifts left
//   and dims; back reverses it.
// - zoom — opening a trip from its tile: the tile grows to fill the screen
//   (cropped, never squashed) and the trip page fades in over it; back
//   shrinks the page into that same tile, falling back to a pop when the
//   tile isn't on screen.
//
// Only the tile and the trip page root ever get a view-transition-name, and
// only for the duration of one transition, so nothing else on either page
// gets pulled into its own transition group. Tiles carry
// `data-zoom-tile="<name>"`, trip page roots `data-zoom-page="<name>"`
// (names from zoomName()).

import type { MouseEvent } from "react";

type Kind = "push" | "pop" | "zoom-in" | "zoom-out";
type Navigate = (href: string, options?: { scroll?: boolean }) => void;

const HERO = "trip-hero";
// Longest the frozen old page is held while the next one renders. Pages are
// prerendered and prefetched (see generateStaticParams in src/app/m/), so
// in practice this is a frame or two.
const MAX_WAIT_MS = 1500;

// Scroll per page, saved when leaving it forward and restored when coming
// back, so the tile to zoom back into is where the visitor left it. Every
// page is a fixed full-screen view whose root (`[data-page]`) does its own
// scrolling — the document itself never scrolls, so nothing (such as a
// page's background) extends past the screen into a transition snapshot.
const scrollByPath = new Map<string, number>();

function pageRoot(path: string): Element | null {
  return document.querySelector(`[data-page="${CSS.escape(path)}"]`);
}

export function zoomName(slug: string, number: number): string {
  return `${slug}/${number}`;
}

function canAnimate(): boolean {
  return (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Runs `go` instead of the link's default navigation for a plain left
 * click — modified clicks (new tab, etc.) keep the default behavior. */
export function onPlainClick(
  e: MouseEvent<HTMLElement>,
  go: (link: HTMLElement) => void,
): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return;
  }
  e.preventDefault();
  go(e.currentTarget);
}

function fullyOnScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.top >= 0 &&
    r.left >= 0 &&
    r.bottom <= window.innerHeight &&
    r.right <= window.innerWidth
  );
}

/** Resolves with the first element matching `selector` once the next page
 * has rendered it, or null after MAX_WAIT_MS. */
function waitFor(selector: string): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    });
    const timer = setTimeout(() => finish(null), MAX_WAIT_MS);
    function finish(el: Element | null) {
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    }
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** The zoom's corners ease between the page's square ones and this tile's
 * own (home cards and selector tiles differ). */
function applyTileRadius(tile: HTMLElement): void {
  document.documentElement.style.setProperty(
    "--nav-tile-radius",
    getComputedStyle(tile).borderRadius,
  );
}

/** Whether `el` ends up fully on screen once it stops moving — the home
 * sheet, for one, mounts off-screen and snaps into place a few dozen ms
 * later. Checked on timers rather than animation frames: rendering (and so
 * requestAnimationFrame) is paused while a view transition's update
 * callback runs, so a frame-based wait would hang. */
async function settlesOnScreen(el: Element, maxMs = 300): Promise<boolean> {
  let last = el.getBoundingClientRect();
  for (let waited = 0; waited < maxMs; waited += 16) {
    await new Promise((r) => setTimeout(r, 16));
    const now = el.getBoundingClientRect();
    if (now.top === last.top && now.left === last.left && fullyOnScreen(el)) {
      return true;
    }
    last = now;
  }
  return false;
}

function transition(kind: Kind, update: () => Promise<Kind | void>): void {
  const root = document.documentElement;
  root.dataset.nav = kind;
  const t = document.startViewTransition(async () => {
    const finalKind = await update();
    if (finalKind) root.dataset.nav = finalKind;
  });
  t.finished.finally(() => {
    delete root.dataset.nav;
    root.style.removeProperty("--nav-tile-radius");
    for (const el of document.querySelectorAll<HTMLElement>(
      "[data-zoom-tile], [data-zoom-page]",
    )) {
      el.style.viewTransitionName = "";
    }
  });
}

/** Forward navigation from a tile: "push" slides the next page in, "zoom"
 * grows `tile` into it. */
export function navigateForward(
  tile: HTMLElement,
  href: string,
  kind: "push" | "zoom",
  navigate: Navigate,
): void {
  scrollByPath.set(
    location.pathname,
    pageRoot(location.pathname)?.scrollTop ?? 0,
  );
  const name = tile.dataset.zoomTile;
  if (!canAnimate()) return navigate(href);
  if (kind === "push" || !name) {
    transition("push", async () => {
      navigate(href);
      await waitFor(`[data-page="${CSS.escape(href)}"]`);
    });
    return;
  }
  tile.style.viewTransitionName = HERO;
  applyTileRadius(tile);
  transition("zoom-in", async () => {
    tile.style.viewTransitionName = "";
    navigate(href);
    const page = await waitFor(`[data-zoom-page="${CSS.escape(name)}"]`);
    if (page instanceof HTMLElement) page.style.viewTransitionName = HERO;
  });
}

/** Back button: "zoom" shrinks the current trip page into its tile on the
 * page at `href` (or pops if that tile isn't on screen); "pop" slides the
 * current page away to the right. */
export function navigateBack(
  from: HTMLElement,
  href: string,
  kind: "zoom" | "pop",
  navigate: Navigate,
): void {
  const restoreScroll = () => {
    const root = pageRoot(href);
    if (root) root.scrollTop = scrollByPath.get(href) ?? 0;
  };
  if (!canAnimate()) {
    navigate(href, { scroll: false });
    waitFor(`[data-page="${CSS.escape(href)}"]`).then(restoreScroll);
    return;
  }
  const page = from.closest<HTMLElement>("[data-zoom-page]");
  const name = page?.dataset.zoomPage;
  if (kind === "zoom" && page) page.style.viewTransitionName = HERO;
  transition(kind === "zoom" && page ? "zoom-out" : "pop", async () => {
    if (page) page.style.viewTransitionName = "";
    navigate(href, { scroll: false });
    await waitFor(`[data-page="${CSS.escape(href)}"]`);
    restoreScroll();
    if (kind !== "zoom" || !page || !name) return;
    const tile = document.querySelector(
      `[data-zoom-tile="${CSS.escape(name)}"]`,
    );
    if (tile instanceof HTMLElement && (await settlesOnScreen(tile))) {
      tile.style.viewTransitionName = HERO;
      applyTileRadius(tile);
    } else {
      return "pop";
    }
  });
}
