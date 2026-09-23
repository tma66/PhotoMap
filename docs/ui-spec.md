# UI spec

Captured live from polarsteps.com, mapbox.com/showcase/polarsteps, and the
App/Play Store screenshots (2026-09-23). The full research notes are in the
build plan (`~/.claude/plans/what-can-you-tell-serene-bubble.md`); this file
is the trimmed reference to check a change against.

Mobile only — target 390×844 iPhone (also 360–430px). No desktop layout; on
wide viewports the layout is simply centered at `max-width: 480px`
(`#app-shell` in `src/app/layout.tsx`).

## Tokens (`src/app/globals.css`, Tailwind `@theme`)

| Token                           | Value                 | Use                  |
| ------------------------------- | --------------------- | -------------------- |
| `--color-ps-navy`               | `#00293D`             | header/primary       |
| `--color-ps-navy-text`          | `#002E3D`             | body text            |
| `--color-ps-muted` / `-muted-2` | `#4D5A6E` / `#69788C` | secondary text       |
| `--color-ps-border`             | `#B8C1CC`             | borders, icons       |
| `--color-ps-bg`                 | `#F6F5F2`             | page background      |
| `--color-ps-card`               | `#FFFFFF`             | cards                |
| `--color-ps-link`               | `#0099E5`             | links, DAY tab       |
| `--color-ps-accent`             | `#DE2B52`             | badges, "New" ribbon |
| `--color-ps-header-text`        | `#E7EAEE`             | text on navy         |

Fonts: Montserrat (UI), Noto Serif (journal text) — see `--font-sans` /
`--font-serif`. No Polarsteps logo, wordmark, or their licensed
"Polarsteps Fellix" font; no "Get the app" / "Travel Books" CTAs.

## Trip page (`/m/[slug]`) — `TripView.tsx`

Full-screen satellite map (`TripMap.tsx`), no header bar. Overlaid
(`MapOverlayHeader.tsx`): white back button (→ `/`) top-left, navy hamburger
(share) top-right, owner + title centered, stats pill (`28 days · 37 steps ·
4,099 km`).

Route: solid white line for ground legs (drawn through the trip's actual
geotagged points — `TrackPoint` rows — not a straight line between steps),
dashed arc for flights (`src/lib/route.ts`). Circular photo pins, white
border, red ring on the active step.

Bottom step carousel (`StepCarousel.tsx`): blue `DAY n` tab, swipeable cards
(cover photo, title, flag/place, 📷/🎬 counts, "New" ribbon on the latest
step). Swiping updates the map; tapping a pin scrolls the carousel.

Tapping a card opens the story view (`StepStory.tsx`): story progress bars,
photos auto-advance (~5s) or play video, tap left/right third of the screen
to go back/forward, swipe down to close, journal text with "Show more".

**Deviations from the original spec** (time-boxed simplifications, not
forgotten):

- The story view doesn't keep a live mini-map visible at the top — full-bleed
  media only. Worth adding later.
- No `redirects.json` for retired slugs yet.
- `.gpx` import (to override the ground route with a real recorded track)
  isn't wired up — the route is built from photo/video GPS only.
- Route decorations missing: small white dots along ground legs, plane icon
  mid-arc on flights, per-leg transport icons (`RouteLeg.midpoint` is
  computed in `src/lib/route.ts` for this but unused), red trip-end dot,
  number badge on multi-photo pins.
- Hamburger opens the native share sheet only — not a trip-info/stats sheet.
  No per-step share link (`/m/<slug>#step-n`).
- `DAY n` tab has no activity icon; carousel cards aren't joined by a
  dotted line.
- Story view: no pinch-zoom, no video mute toggle (video is phase 2 anyway).
- Home: country badge is a circle, not a hexagon; globe doesn't fill visited
  countries; stat tiles are plain colour, no illustrations; no home-country
  flag next to the name (`profile.json` has no `homeCountry` field yet).
- Trip `description` (from `trip.json`) is stored but not shown anywhere.

## Home page (`/`) — `HomeView.tsx`

3D globe (`GlobeMap.tsx`, MapLibre `projection: 'globe'`), slow auto-rotate
until touched, all trips' steps as pins + thin routes. Bottom sheet (`vaul`
Drawer, peek/full snap points): profile (avatar, red country-count badge,
bio), `Countries | Trips | Steps` row, **Trips** tab (cards with
`NOVEMBER 2024 · 681 DAYS · 69,951 KM · 708 STEPS`) and **Statistics** tab
(`32 countries` / `16% of the world` tiles, continents strip).

No trip planner, "Destination snapshots", social feed, or bottom tab bar —
this is a read-only visitor site.

## Map

`TripMap.tsx` / `GlobeMap.tsx`: Mapbox raster tiles when
`NEXT_PUBLIC_MAPBOX_TOKEN` is set (satellite, matches the real app), else
keyless Esri World Imagery via MapLibre GL. See "Map troubleshooting" in
`docs/setup.md` if the map doesn't render after a fresh clone.

## Later ideas (not built)

- Video ingestion (schema is ready — `Media.type`, `durationSec` — pipeline
  isn't; see the top comment in `src/ingest/index.ts`).
- "Trip Reels" — an auto-generated highlight slideshow per trip.
