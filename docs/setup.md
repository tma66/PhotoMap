# Running Travel Steps on your Mac

## First-time setup

```
npm install
cp .env.example .env        # already done if you're reading this from the repo
npx prisma generate
npx prisma db push          # creates data/travel-steps.db
```

Node v22.10+ works; `prisma`/`eslint` print an `EBADENGINE` warning wanting
22.12+/22.13+ but both run fine here. Ignore it, or `brew upgrade node` if it
bothers you.

## Add a trip

1. Make a folder under `assets/`, e.g. `assets/japan-2025/`. **The folder
   name is the URL slug and gets written onto an NFC tag — don't rename it
   later.**
2. Drop photos in (JPEG/HEIC/PNG). EXIF date + GPS drives everything;
   captions come from the photo's "Description"/IPTC field (Apple Photos:
   right-click a photo → Get Info → add a caption before exporting).
3. `npm run ingest -- japan-2025` (or `npm run ingest` for every trip, or
   `npm run ingest -- --watch` to keep watching `assets/` in the background).
4. Optional `assets/japan-2025/trip.json` to override the auto title/desc:
   ```json
   { "title": "Japan, spring 2025", "description": "..." }
   ```
   Optional `assets/profile.json` for the home page's name/bio/avatar.

## Run it

```
npm run build && npm start     # production server, http://localhost:3000
```

Or `npm run dev` while you're working on it.

## Expose it with Tailscale Funnel

```
brew install --cask tailscale
# sign in via the Tailscale menu bar app, then enable Funnel for this
# device in the Tailscale admin console (Machine → ... → Funnel)
tailscale funnel --bg 3000
tailscale funnel status        # prints your public https://<name>.<tailnet>.ts.net URL
```

## Keep it running

- **Prevent sleep:** System Settings → Lock Screen → turn off "Turn display
  off"-triggered sleep for this Mac, or run the server under `caffeinate -s`.
- **Start at login / restart on crash:** copy `scripts/com.travelsteps.web.plist`
  and `scripts/com.travelsteps.ingest.plist` to `~/Library/LaunchAgents/`,
  edit the paths inside to match where you cloned the repo, then:
  ```
  launchctl load ~/Library/LaunchAgents/com.travelsteps.web.plist
  launchctl load ~/Library/LaunchAgents/com.travelsteps.ingest.plist
  ```

## Write an NFC tag

Use a free app — **NXP TagWriter** or **NFC Tools** — to write a URL record:

```
https://<your-name>.<your-tailnet>.ts.net/m/japan-2025
```

Test it with your own phone before sticking the tag on anything, and lock
the tag once you're happy (most NFC-writer apps have a "lock" option) so it
can't be accidentally overwritten.

## Backups

`assets/` is the only thing that matters — back it up (Time Machine, iCloud,
whatever you already use). `data/` (the SQLite cache + resized photos) is
fully regenerable with `npm run ingest -- --rebuild` and doesn't need backing
up.

## Known issues / rough edges

- **Map troubleshooting:** MapLibre GL's web worker needs two files copied
  into `public/maplibre/` (Turbopack doesn't bundle them correctly on its
  own) — `npm run build`/`npm run dev` do this automatically via the
  `prebuild`/`predev` scripts. If the map is ever just a blank navy screen
  with no pins, run `node scripts/copy-maplibre-worker.mjs` by hand and
  restart the server.
- **Home page bottom sheet:** its peek/full snap heights were finicky to
  verify in this project's automated browser tooling (see the build
  session's notes) — it worked correctly by hand every time it was checked,
  but give it a look on a real phone after any change nearby
  (`src/components/HomeView.tsx`).
- `npm audit` flags 2 dev-only tools (`vitest`'s mocker, Prisma CLI's config
  merging) — both are local build-time tools a site visitor can't reach, not
  something shipped to the browser. Not worth a breaking major-version bump
  for a personal project; revisit if `npm audit` ever flags something in a
  runtime dependency.
- Weather and place names come from Open-Meteo (free, no key) and two
  bundled offline datasets (`@geo-maps/countries-land-10km`,
  `all-the-cities`) — no accounts needed for any of it. The one optional
  account is Mapbox, for nicer satellite tiles (`NEXT_PUBLIC_MAPBOX_TOKEN`);
  everything works without it via keyless Esri tiles.
