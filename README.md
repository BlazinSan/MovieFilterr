# CUEPOINT — every scene, timestamped

> Type any movie or show. CUEPOINT lays out **every parental-guidance notice on a
> timeline** — exact timecodes, colour-coded by category. If a title contains
> nudity, it surfaces **clean same-genre picks** that have none.

A single-page, dependency-free web app built for calm, informed viewing.

![CUEPOINT](docs/preview.png)

---

## What it does

1. **Scan** — search any title (fuzzy matching finds it from a fragment, initials, or a typo).
2. **Timeline** — every advisory is pinned to its timecode across colour-coded,
   scrubbable lanes. Drag the playhead, hover a marker, or use the arrow keys.
3. **Cue list** — a second-by-second list of every notice: category, severity, and what happens. Filter by category.
4. **Clean picks** — if nudity is present, it recommends same-genre titles with
   **none in the log**, ranked by genre overlap.

Categories tracked: **Nudity & Sex · Violence & Gore · Profanity · Alcohol & Drugs ·
Frightening & Intense · Mature Themes**, each with a 1–3 severity scale.

## Honest note on the data

There is **no free public API that returns *timestamped* parental advisories** for
arbitrary titles. IMDb's Parents Guide, Common Sense Media, and similar sources have
no machine-readable timecodes. So the timecodes in [`data.js`](data.js) are
**hand-authored, illustrative reference data** for ~22 well-known films and shows —
they are *not* a frame-accurate authority.

The UI is built as a clean **demonstration layer over a swappable data source**: replace
the `DATA` array (or feed it from a backend) and the timeline, cue list, nudity verdict,
and recommendations all keep working unchanged. A realistic production source would be a
moderated community database (think the model behind sites like *Does the Dog Die?*).

## Run it

It's pure HTML/CSS/JS — no build step.

```bash
# easiest: just open index.html in a browser
# or serve it (recommended, avoids any file:// quirks):
python -m http.server 5173
#   → http://localhost:5173
```

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "CUEPOINT"
git branch -M main
git remote add origin https://github.com/<you>/cuepoint.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build from branch → `main` / root**. Done — it's a static site.

## Project structure

| File | Role |
|------|------|
| [`index.html`](index.html) | Markup, font links, page structure |
| [`styles.css`](styles.css) | Design system, animations, responsive + reduced-motion |
| [`data.js`](data.js) | Curated dataset (`DATA`, `CATEGORIES`, `SEVERITY`) — **swap this for live data** |
| [`app.js`](app.js) | Search, fuzzy matching, timeline scrubber, cue list, recommendations |

## Design

- **Type** — Clash Display (headlines) + Cabinet Grotesk (body) via Fontshare, JetBrains Mono for timecodes.
- **Feel** — cinematic near-black, film-grain + vignette, drifting aurora, category-coded colour system.
- **Signature UI** — a multi-lane scrubbable scene timeline with animated markers and a live timecode readout.
- **Accessible** — keyboard-scrubbable slider, ARIA roles, focus states, and full `prefers-reduced-motion` support.
- **Fast** — no dependencies, no framework; CSS transforms, `IntersectionObserver` reveals, `requestAnimationFrame` counters.

---

*Made for informed, calmer viewing.*
