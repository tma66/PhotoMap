# PhotoMap

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

- **macOS.** HEIC→JPEG conversion shells out to the built-in `sips` tool, so
  this doesn't run on Linux/Windows.
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
   name becomes the trip's URL slug (`/m/japan-2025`); don't rename it
   later**, especially once it's on an NFC tag.
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
already geotagged. Type in a `coord` (`"lat,lng"`) for anything left blank,
then re-ingest normally. **The `--` before the flag is required**: without
it, npm swallows the flag and runs a plain ingest instead.

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

Visit `http://localhost:3000` on this Mac to view it right away, before
setting up remote access below.

**Keep it running across reboots/crashes:** copy `scripts/com.photomap.web.plist`
and `scripts/com.photomap.ingest.plist` into `~/Library/LaunchAgents/`,
edit the `WorkingDirectory` path in each to where you cloned the repo, then:

```
launchctl load ~/Library/LaunchAgents/com.photomap.web.plist
launchctl load ~/Library/LaunchAgents/com.photomap.ingest.plist
```

Also turn off display-sleep for this Mac (System Settings → Lock Screen), or
run under `caffeinate -s`.

**Expose it beyond your LAN** with [Tailscale Funnel](https://tailscale.com/):

```
brew install --cask tailscale
# sign in, then enable Funnel for this device in the Tailscale admin console
tailscale funnel --bg 3000
tailscale funnel status   # prints your public https://<name>.<tailnet>.ts.net URL
```

(`scripts/start-funnel.sh` does the same, reading the port from `$PORT`.)

**Write an NFC tag** (free app: NXP TagWriter or NFC Tools) with a URL
record pointing at `https://<your-funnel-url>/m/<slug>`. Test it with your
own phone before sticking it on anything, and lock the tag once it works so
it can't be accidentally overwritten.

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

## Backups

`assets/` is the only thing that matters; back it up however you already
back up this Mac. The SQLite DB (`prisma/data/`) and resized-photo cache
(`data/cache/`) are both fully regenerable with `npm run ingest -- --rebuild`.

## License

[AGPL-3.0](LICENSE): if you run a modified version of this as a public
service, you must also offer its users the modified source code.
