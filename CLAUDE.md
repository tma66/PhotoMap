# Travel Steps

Self-hosted, read-only Polarsteps look-alike, generated automatically from
photos and run on the owner's Mac. Friends reach a trip via an NFC fridge
magnet's URL. No login, no editor UI — content comes entirely from
`assets/<slug>/` folders.

- **Plan / design rationale:** `~/.claude/plans/what-can-you-tell-serene-bubble.md`
- **UI spec (colors, layouts, captured from the real Polarsteps app):** `docs/ui-spec.md`
- **Running it on the Mac (Tailscale, launchd, NFC tags):** `docs/setup.md`
- **Content model (how photos become a trip):** `src/ingest/index.ts` (top comment) and `prisma/schema.prisma`

## Commands

- `npm run dev` / `npm run build && npm start` — the web app
- `npm run ingest -- --rebuild` — regenerate the DB + photo cache from `assets/`
- `npm run ingest -- --watch` — keep it updated as photos are added
- `npm test` — vitest
- `npm run lint` — eslint

## Conventions

- The SQLite DB (`data/`) is a **rebuildable cache**, never hand-edited — see `prisma/schema.prisma`.
- Media derivatives are content-addressed (`<hash>-thumb.jpg` / `-display.jpg`); see `src/lib/media-path-safety.ts` for the request-validation rules the `media` route relies on.
- Mobile-only UI (no desktop layout) — see `docs/ui-spec.md` before changing a page's layout.
