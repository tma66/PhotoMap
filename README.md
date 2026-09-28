# PhotoMap

<img src="https://github.com/tma66/PhotoMap/releases/download/readme-assets/demo.webp" alt="PhotoMap demo" width="360" />

A self-hosted, read-only travel journal generated automatically from your own
photos and videos, with no login, no cloud, and no editor UI. Point it at a folder of
photos and it builds a mobile trip page: a day-by-day map, a swipeable story
view, and a 3D globe of every trip. Share a trip by handing out its URL (an
NFC tag on a fridge magnet works great).

## Features

- Groups photos/videos into day-by-day "steps" from EXIF/QuickTime GPS + date,
  with no manual trip-building.
- Full-screen story view (photos + video, swipe between steps, tap-to-unmute)
  and a day scrubber over a live map (satellite or streets).
- A 3D auto-rotating globe on the home page showing every trip.
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

Add your first trip (see below), then:

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
   npm run ingest -- japan-2025      # just this trip
   npm run ingest                    # every trip
   npm run ingest -- --watch         # ingest, then keep watching assets/ for changes
   ```

### Filling in gaps (no-GPS photos, wrong location, wrong weather)

```
npm run ingest -- --photos-template japan-2025   # or omit the slug for every trip
```

This (re)writes `assets/japan-2025/trip.json`'s `photos` block: one entry per
photo, grouped by day, with `coord`/location/weather auto-filled for anything
already geotagged, then re-ingests the trip so the site picks it up right
away. Type in a `coord` (`"lat,lng"`) for anything left blank, then re-run
the same command. **The `--` before the flag is required**: without it, npm
swallows the flag and runs a plain ingest instead. In a folder with trip
subfolders, `photos` is grouped by subfolder number first
(`{ "1": { "2025-05-16": [...] }, "3": { ... } }`). A trip with no
geotagged photo at all is left off the site until you fill in a `coord`.
Existing entries are never moved or reordered: to fix a photo's date (e.g.
one with no EXIF date, which falls back to the file's date), move its entry
under the right date and it's treated as taken that day. Change a `coord`
and the next run re-derives that photo's `locationName` and weather; a name
or weather you typed yourself is kept as long as its coord stays the same.

### Other overrides

Optional `assets/japan-2025/trip.json` fields, on top of the auto-filled
`photos` block above:

```json
{
  "title": "Japan, spring 2025",
  "cover": "IMG_1234.jpg",
  "stepTitles": { "2": "Kyoto detour" }
}
```

- `cover`: filename of the photo used as the trip's card image (defaults to
  the first step's first photo).
- `stepTitles`: override a step's auto-generated title, keyed by day number.
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
- **Remove a whole trip:** delete `assets/<slug>/` entirely, then
  `npm run ingest -- --rebuild`. A plain ingest (or `--watch`) won't clean it
  up: both only rebuild trips they can still find a folder for, so a wiped
  DB + full re-ingest is the only way to drop a trip that's gone from disk.

## Deploying / making it reachable

Run the production build as a long-lived process:

```
npm run build && npm start
```

Visit `http://localhost:3000` to view it right away

## Environment variables

See `.env.example` for the full list with comments. The ones worth knowing
about up front:

- `NEXT_PUBLIC_MAPBOX_TOKEN`: optional, a free Mapbox account's
  URL-restricted **public** token, for nicer satellite/streets tiles and the
  3D globe projection. Leave blank to fall back to keyless Esri tiles (lower
  detail, no globe). **Changing this requires a rebuild** (`npm run build`),
  not just a restart, since Next.js inlines `NEXT_PUBLIC_*` vars into the
  client bundle at build time.
- `INGEST_WEATHER=off`: skip fetching weather during
  `--photos-template` (weather is otherwise cached into `trip.json`, never
  fetched during a normal ingest).
- `UNITS`: `km` or `mi`.
- `SITE_URL`: where ingest reaches the running site to refresh its pages
  right after an ingest (default `http://localhost:3000`). Pages are
  otherwise built once and only change after an ingest or a rebuild.

## License

[AGPL-3.0](LICENSE): if you run a modified version of this as a public
service, you must also offer its users the modified source code.
