# PhotoMap

<img src="https://github.com/tma66/PhotoMap/releases/download/readme-assets/demo.webp" alt="PhotoMap demo" width="360" />

A self-hosted travel journal generated automatically from your own photos
and videos, with no login and no cloud. Point it at a folder of
photos and it builds a mobile trip page: a day-by-day map, a swipeable story
view, and a 3D globe of every trip. Share a trip by handing out its URL (an
NFC tag on a fridge magnet works great).

## Features

- Groups photos/videos into day-by-day "steps" from EXIF/QuickTime GPS + date,
  with no manual trip-building.
- Full-screen story view (photos + video, swipe between steps, tap-to-unmute)
  and a day scrubber over a live map (satellite or streets), with dotted
  route lines between cities that you can toggle off. Each city-to-city
  trip is drawn once per direction, gently curved, so trips back and forth
  don't pile up on top of each other.
- Fix a step's location right on the trip page: search for a place or drag
  the map under a pin, and every photo in that step moves there.
- A 3D auto-rotating globe on the home page showing every trip.
- Installable on an iPhone via Safari's **Add to Home Screen**, opening
  full-screen like an app. Put your own icons at `public/icon-192.png`,
  `public/icon-512.png`, `src/app/icon.png` and `src/app/apple-icon.png`
  (gitignored).
- Runs entirely from your own machine, with no account and no third-party storage.
  An optional free Mapbox token upgrades the map tiles; everything works
  without one.

## Prerequisites

- **Node 22.10+**
- **ffmpeg**: `brew install ffmpeg` (transcodes videos, extracts poster
  frames)

## Quickstart

```
git clone git@github.com:tma66/PhotoMap.git
cd PhotoMap
npm install
cp .env.example .env
npx prisma generate
npx prisma db push      # creates prisma/data/photomap.db
```

`assets/example/` is a bundled demo trip: it isn't listed on the home page,
but opens at `/m/example/1`. Add your first trip (see below), then:

```
npm run build && npm start   # http://localhost:3000
```

## Adding photos & videos

1. Make a folder under `assets/`, e.g. `assets/japan-2025/`. **The folder
   name becomes the trip's URL slug** (`/m/japan-2025/1`). One folder can
   hold several trips (e.g. the same festival every year): put each trip's
   photos in a numbered subfolder (`assets/edc/1/`, `assets/edc/3/`). The
   number is the trip's URL (`/m/edc/3`), and `/m/edc` becomes a page to
   pick between them. A folder with only photos in it is a single trip.
2. Drop photos (JPEG/HEIC/PNG) and videos (MOV/MP4/M4V) in. A caption comes
   from a photo's "Description"/IPTC field (Apple Photos: right-click → Get
   Info → add a caption before exporting). A photo or video with no GPS, on a
   day with no other geotagged item to fall back on, is dropped rather than
   guessed at.
3. Ingest it:
   ```
   npm run ingest japan-2025      # just this trip
   npm run ingest                    # every trip
   npm run watch                     # ingest, then keep watching assets/ for changes
   ```
   `npm run` alone lists every command.

### What an ingest does

For each trip, `npm run ingest`:

1. **Renames its files.** An image whose extension doesn't match its content
   gets the right one (e.g. a JPEG named `.HEIC`, which Finder can't
   preview), and each file gets its local date and time as a prefix
   (`20221225-153803_IMG_4842.jpg`) so the folder sorts by time; a clashing
   name gets `-2`. Files with no recorded date keep their name.
2. **(Re)writes `trip.json`'s `photos` block:** one entry per photo, grouped
   by day, with `coord`/location/weather auto-filled for anything geotagged.
   A photo with no GPS takes the coord of the nearest-in-time photo that day.
   Type a `coord` (`"lat,lng"`) for anything still blank, then re-run. An
   entry filed up to 7 days from the date its file records moves to that
   date (a hand-typed coord becomes that of the nearest photo within 6
   hours; the file's own GPS stays). A file with no recorded date that's
   still on its copy date is filed under its nearest `IMG_####` neighbours'
   date (the nearest within 5 numbers, or the date shared by the ones either
   side); one you've moved by hand stays put. Either way it's slotted, and
   given a coord, by number. Files with a timed neighbour but no clear date,
   or whose numbers two cameras (by make/model) both used, are printed to
   move by hand; the rest stay on their copy date, last, by name. To fix a
   date that's wrong in the file (a copy date, a screen recording's), move
   the entry in `trip.json`; ingest keeps it there. Entries stay in time
   order within each date, and a changed `trip.json` is backed up as
   `trip.json.<timestamp>.bak`. In a folder with trip subfolders, `photos`
   is grouped by subfolder number first
   (`{ "1": { "2025-05-16": [...] }, "3": { ... } }`).
3. **Prints duplicate images** (exact copies, or the same picture resized,
   re-compressed or converted, whatever the filename) with their paths,
   largest copy first, so you can delete the ones you don't want; all copies
   stay on the site until you do, except byte-identical ones, shown once.
   Compared within each trip; videos aren't
   compared.
4. **Updates the site.** A trip with no geotagged photo at all is left off
   until you fill in a `coord`. With no slug, trips whose folder is gone
   are dropped too.

`--watch` and `--rebuild` only do step 4: they never rename files or write
`trip.json` (so `--watch` doesn't rename photos still being copied in).
New photos picked up by `--watch` get renamed on the next `npm run ingest`.

Change a `coord`
and the next run re-derives that photo's `locationName`, `cityName` and
weather; a value you typed yourself is kept as long as its coord stays the
same. Weather is the daytime (9am–6pm) high and typical conditions,
fetched once per photo and kept. `cityName` (the biggest place within 25 km,
so a neighborhood counts as its city) decides the dotted route lines: they
only join consecutive steps in different cities, so type a different one to
group or split steps.

To fix a whole step's location, press and hold its card on the trip page:
it writes the new `coord`, place names and weather to
every photo in that step and updates the site in a second or two. **Anyone
on your home network can do this**; visitors through the public link can't.

### Other overrides

Optional `assets/japan-2025/trip.json` fields, on top of the auto-filled
`photos` block above:

```json
{
  "title": "Japan, spring 2025",
  "public": true,
  "stepTitles": { "2": "Kyoto detour" }
}
```

- Card image: add `"cover": true` to a photo's entry in the `photos` block
  (one per trip; several → the earliest, with a warning). Defaults to the
  first step's first photo.
- `public`: show every trip in this folder to visitors through the public
  link (see [Public link](#public-link)); trips are private by default.
- `stepTitles`: override a step's auto-generated title, keyed by step
  position (`"0"` is the first step).
  In a folder holding several trips, nest it by trip number:
  `{ "2": { "0": "Main stage" } }`.

Optional `assets/profile.json` sets the home page's name/bio/avatar:
`{ "name": "...", "bio": "...", "avatar": "/your-photo.png" }` (the photo
itself goes in `public/`).

## Removing photos & trips

Every ingest fully rebuilds a trip from its current source folder; nothing
is additive.

- **Remove some photos:** delete the files from `assets/<slug>/`, then
  re-ingest that trip (or let `--watch` catch the deletion).
- **Remove a whole trip:** delete `assets/<slug>/` entirely; `--watch`, a
  plain ingest (no slug) drops it from the site (skipped if `assets/` has
  no folders at all, e.g. an unmounted drive).
- Ingest (not `--watch`) also deletes the removed files' or trip's cached
  media from `data/cache/`.
- **Rename a trip:** `npm run rename <old> <new>`. Renaming the
  folder by hand works too, but re-encodes all its media into a new cache
  folder.

## Deploying / making it reachable

Run the production build as a long-lived process:

```
npm run build && npm start
```

Visit `http://localhost:3000` to view it right away

### Public link

To share with someone outside your network, expose it with
[Tailscale Funnel](https://tailscale.com/kb/1223/funnel):
`tailscale funnel --bg 3000`. Requests to the `*.ts.net` name are treated
as public visitors (`src/proxy.ts`): they see only trips marked
`"public": true`, can't change anything, and pages are sent with
`X-Robots-Tag: noindex`.

## Environment variables

See `.env.example` for the full list with comments. The ones worth knowing
about up front:

- `NEXT_PUBLIC_MAPBOX_TOKEN`: optional, a free Mapbox account's
  URL-restricted **public** token, for nicer satellite/streets tiles and the
  place search when changing a step's location. Leave blank to fall back to
  keyless Esri tiles (lower detail, no place search). **Changing this requires a rebuild** (`npm run build`),
  not just a restart, since Next.js inlines `NEXT_PUBLIC_*` vars into the
  client bundle at build time.
- `INGEST_WEATHER=off`: skip fetching weather during ingest and
  step-location changes (fetched weather is kept in `trip.json`, so each
  photo's is fetched once).
- `UNITS`: `km` or `mi`.
- `SITE_URL`: where ingest reaches the running site to refresh its pages
  right after an ingest (default `http://localhost:3000`). Pages are
  otherwise built once and only change after an ingest or a rebuild.

## Development

```
npm test          # vitest
npm run lint      # eslint
```

## License

[AGPL-3.0](LICENSE): if you run a modified version of this as a public
service, you must also offer its users the modified source code.
