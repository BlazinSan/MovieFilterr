# CUEPOINT — every scene, timestamped

> Search any movie or show. CUEPOINT detects parental-guidance content (nudity,
> violence, profanity, substances, frightening, mature themes), lays out a
> **scrubbable timeline of timestamped notices**, and — when nudity is present —
> recommends **same-genre titles with no nudity flagged**.

**Live:** https://cuepoint-nine.vercel.app

A single-page front-end (no framework) backed by lightweight Vercel serverless
functions that proxy **TMDB** for live search and nudity detection.

---

## What it does

1. **Search** any title — live via TMDB (any film/show ever made), with fuzzy
   fallback over a curated library when TMDB isn't configured.
2. **Nudity verdict** — three honest states:
   - **Contains nudity** — confirmed (TMDB nudity keyword present, or in our verified log).
   - **No nudity** — only for titles in our hand-verified log.
   - **Unconfirmed** — TMDB has no nudity tag, *which is not a guarantee of none*
     (TMDB's crowd tags are sparse). The UI points you to the IMDb Parents Guide.
3. **Timeline** — for titles in our verified log, every advisory is pinned to its
   timecode across colour-coded, scrubbable lanes (drag the playhead, hover a marker, arrow-key it).
4. **Cue list** — a second-by-second list of every notice: category, severity, description, filterable.
5. **Clean picks** — same-genre recommendations filtered to exclude flagged nudity, ranked by genre overlap.
6. **Source deep-links** — every result one-clicks out to IMDb Parents Guide,
   Reddit, Unconsented, DoesTheDogDie, pre-searched for that exact title.

## The honest data story

**No public API returns frame-accurate nudity *timestamps* for arbitrary titles** —
not TMDB, IMDb, Reddit, or any social platform (those have no such structured data,
and scraping them is against ToS and technically blocked). So CUEPOINT is built from
what *is* real and legitimate:

| Source | What it actually gives | Used for |
|--------|------------------------|----------|
| **TMDB API** | search, genres, posters, certifications, **keyword tags** (incl. nudity), recommendations | live search, nudity *signal*, clean recs |
| **Curated log** ([`data.js`](data.js)) | hand-authored, timestamped advisories for ~22 well-known titles | the scrubbable timeline + cue list |
| **IMDb / Reddit / Unconsented / DTDD** | crowd-sourced scene info (no API) | one-click deep-link searches per title |

TMDB keyword coverage for nudity is **high-precision, low-recall** — a positive tag
is trustworthy, but its *absence* is not, so CUEPOINT never reports a false "no nudity"
for a TMDB-only title; it says **unconfirmed** and links you to the authoritative
IMDb Parents Guide.

## Architecture

```
index.html · styles.css · data.js · app.js      # static front-end (no build)
api/
  _lib/tmdb.js     # shared TMDB client + keyword nudity signal (key stays server-side)
  config.js        # GET /api/config -> { live } (is TMDB configured?)
  search.js        # GET /api/search?q= -> simplified multi-search
  title.js         # GET /api/title?type=&id= -> detail + nudity + clean recs
vercel.json · package.json
```

The TMDB key is **never exposed to the client** — the browser only ever calls our
own `/api/*`. With no key set, the site runs in **demo mode** on the curated library.

## Run locally

```bash
# static-only (demo mode, curated library):
python -m http.server 5173          # -> http://localhost:5173

# full live mode (serverless + TMDB):
npm i -g vercel
vercel dev                          # reads TMDB_TOKEN/TMDB_API_KEY from project env
```

## Configure live TMDB search

Set **one** of these as an env var on the Vercel project (Settings → Environment Variables),
then redeploy:

| Var | Value |
|-----|-------|
| `TMDB_TOKEN` | TMDB **v4 Read Access Token** (long JWT) — sent as `Bearer` |
| `TMDB_API_KEY` | TMDB **v3 API key** (32 chars) — sent as query param |

Get one free at [themoviedb.org](https://www.themoviedb.org/settings/api). The app
auto-detects via `/api/config` and flips the header badge to **Live · TMDB**.

## Deploy

```bash
vercel --prod        # already linked to the "cuepoint" project
```

## Design

- **Type** — Clash Display + Cabinet Grotesk (Fontshare), JetBrains Mono for timecodes.
- **Feel** — cinematic near-black, film-grain + vignette, drifting aurora, six-category colour system.
- **Signature UI** — a multi-lane scrubbable scene timeline with animated markers and a live timecode readout.
- **Accessible** — keyboard-scrubbable slider, ARIA roles, focus states, full `prefers-reduced-motion` support.
- **Fast** — zero front-end dependencies; CSS transforms, `IntersectionObserver`, `requestAnimationFrame`.

---

*Made for informed, calmer viewing.*
