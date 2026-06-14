/* ============================================================================
   MovieFilterr — app logic
   Live mode: searches TMDB via /api/* (real nudity detection for ANY title).
   Fallback mode: curated dataset only (when no TMDB key is configured).
   ========================================================================== */
(function () {
  "use strict";

  const { DATA, CATEGORIES, SEVERITY } = window.MovieFilterr;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let LIVE = false; // set by detectLive()

  /* ----------------------------- utilities ------------------------------- */
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  }
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function nudityOf(title) {
    if (title.advisories && title.advisories.length)
      return title.advisories.some((a) => a.category === "nudity");
    if (typeof title.liveNudity === "boolean") return title.liveNudity;
    return false;
  }
  function nudityKnown(title) {
    return (title.advisories && title.advisories.length > 0) || typeof title.liveNudity === "boolean";
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function posterStyle(t) {
    const h = hashHue(t.id || t.title || "x");
    const h2 = (h + 48) % 360;
    return `background:
      radial-gradient(120% 90% at 20% 0%, hsl(${h} 70% 22%), transparent 60%),
      linear-gradient(150deg, hsl(${h} 65% 30%), hsl(${h2} 60% 18%));`;
  }
  function initials(t) {
    const words = (t.title || "").replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase() || "??";
  }
  // poster inner: real image when available, else gradient initials
  function posterInner(t, big) {
    if (t.poster)
      return `<img class="pimg" src="${t.poster}" alt="${(t.title || "").replace(/"/g, "&quot;")} poster" loading="lazy" />`;
    return `<span class="pinitial">${initials(t)}</span><span class="pshine"></span>`;
  }

  /* --------------------------- local fuzzy search ------------------------ */
  function score(query, title) {
    const q = query.toLowerCase().trim();
    if (!q) return 0;
    const t = title.title.toLowerCase();
    if (t === q) return 1000;
    if (t.startsWith(q)) return 800 - t.length;
    if (t.includes(q)) return 600 - t.indexOf(q);
    const initialsStr = t.split(/\s+/).map((w) => w[0]).join("");
    if (initialsStr.startsWith(q)) return 500;
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
    if (qi === q.length) return 200 - (t.length - q.length);
    const hit = q.split(/\s+/).filter((w) => w.length > 1 && t.includes(w)).length;
    return hit > 0 ? 100 + hit * 20 : 0;
  }
  function localSearch(query, limit = 6) {
    return DATA.map((t) => ({ t, s: score(query, t) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.t);
  }
  const localBest = (q) => localSearch(q, 1)[0] || null;

  function curatedMatch(title, year) {
    const nt = norm(title);
    return (
      DATA.find((d) => norm(d.title) === nt && (!year || Math.abs(d.year - (+year || d.year)) <= 1)) ||
      DATA.find((d) => norm(d.title) === nt) ||
      null
    );
  }

  /* ------------------------------ API layer ------------------------------ */
  async function jget(url, ms = 12000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }
  async function detectLive() {
    try { const c = await jget("/api/config", 5000); LIVE = !!c.live; }
    catch { LIVE = false; }
    return LIVE;
  }
  async function apiSearch(q) {
    try { const d = await jget("/api/search?q=" + encodeURIComponent(q)); return d.results || []; }
    catch { return []; }
  }
  async function apiTitle(type, id) { return jget(`/api/title?type=${type}&id=${id}`); }

  // TMDB payload -> internal title shape, merging curated timestamps if we have them
  function adaptTmdb(payload) {
    const t = payload.title;
    const cur = curatedMatch(t.title, t.year);
    return {
      id: "tmdb-" + t.type + "-" + t.id,
      tmdbId: t.id, tmdbType: t.type, type: t.type,
      title: t.title,
      year: t.year || (cur && cur.year) || "",
      cert: t.cert && t.cert !== "NR" ? t.cert : (cur && cur.cert) || t.cert || "NR",
      runtime: t.runtime || (cur && cur.runtime) || 0,
      genres: (t.genres && t.genres.length) ? t.genres : (cur ? cur.genres : []),
      tagline: t.tagline || (cur && cur.tagline) || "",
      poster: t.poster || null,
      imdb_id: t.imdb_id || null,
      // curated timestamps win; otherwise DTDD's categorised (timecode-less) list
      advisories: cur ? cur.advisories : (t.advisories || []),
      // API sends true (confirmed) | false (DTDD confirms absence) | null
      // (no reliable signal). null falls through to the "unconfirmed" state.
      liveNudity: typeof t.nudity === "boolean" ? t.nudity : null,
      nudityKeywords: t.nudityKeywords || [],
      nuditySource: t.nuditySource || null,
      nudityVotes: t.nudityVotes || null,
      dtddUrl: t.dtddUrl || null,
      curated: !!cur,
      tmdbRecs: payload.recommendations || [],
    };
  }

  /* ------------------------- recommendations (local) --------------------- */
  function localRecommend(title, limit = 6) {
    const gset = new Set(title.genres);
    return DATA.filter((t) => t.id !== title.id && !nudityOf(t))
      .map((t) => {
        const shared = t.genres.filter((g) => gset.has(g));
        return { t, overlap: shared.length, shared };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        const sev = (t) => t.advisories.reduce((s, a) => s + a.severity, 0);
        return sev(a.t) - sev(b.t);
      })
      .slice(0, limit);
  }

  /* ------------------------------- intro --------------------------------- */
  function runIntro() {
    const intro = $("#intro");
    if (!intro) return;
    const done = () => intro.classList.add("is-done");
    if (reduce) { done(); return; }
    setTimeout(done, 1500);
    window.addEventListener("keydown", done, { once: true });
    intro.addEventListener("click", done, { once: true });
  }

  /* ------------------------- hero ribbon (decor) ------------------------- */
  function buildRibbon() {
    const track = $("#ribbonTrack");
    if (!track) return;
    const colors = Object.values(CATEGORIES).map((c) => c.color);
    const make = () => {
      let s = "";
      for (let i = 0; i < 120; i++) {
        const c = colors[Math.floor(Math.random() * colors.length)];
        const h = 12 + Math.random() * 40;
        s += `<span class="ribbon__tick" style="height:${h}px;background:${c}"></span>`;
      }
      return s;
    };
    track.innerHTML = make() + make();
  }

  /* ------------------------------ rendering ------------------------------ */
  const result = $("#result");

  function showResult(html) {
    result.innerHTML = html;
    result.hidden = false;
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  function showLoading(label) {
    showResult(`
      <article class="rcard">
        <div class="loadbox">
          <div class="loadbox__spin"></div>
          <p>${label || "Reading the scene log…"}</p>
        </div>
      </article>`);
  }

  function render(title) {
    const nud = nudityOf(title);
    const advisories = [...(title.advisories || [])];
    const catOrder = Object.keys(CATEGORIES);
    const hasTimestamps = advisories.some((a) => typeof a.t === "number");
    const hasAdvisories = advisories.length > 0;
    // order: by timecode when available, else by category then severity
    advisories.sort((a, b) =>
      hasTimestamps ? (a.t || 0) - (b.t || 0)
        : (catOrder.indexOf(a.category) - catOrder.indexOf(b.category)) || (b.severity - a.severity));
    const byCat = {};
    for (const a of advisories) (byCat[a.category] ||= []).push(a);
    const usedCats = catOrder.filter((c) => byCat[c]);
    const withTs = advisories.filter((a) => typeof a.t === "number");

    result.innerHTML = `
      <article class="rcard">
        ${headerHTML(title)}
        ${verdictHTML(title, nud, hasTimestamps)}
        ${nudityFirstHTML(advisories)}
        ${hasAdvisories ? summaryHTML(byCat, usedCats, advisories.length, hasTimestamps) : ""}
        ${hasTimestamps ? timelineHTML(title, withTs, usedCats) : ""}
        ${hasAdvisories ? cueListHTML(advisories, usedCats, hasTimestamps) : noTimestampsHTML(title, nud)}
        ${sourcesHTML(title)}
        ${recsHTML(title, nud)}
      </article>`;

    result.hidden = false;
    if (hasTimestamps) wireTimeline(title, withTs);
    if (hasAdvisories) { wireFilters(); countUp(); wireCollapse(); }
    wireShare(title);
    wireRecClicks();
    wireScrollReveal();
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  // gentle fade-up of result sections as they scroll into view
  function wireScrollReveal() {
    const els = $$(".rcard > section", result);
    if (reduce || !("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("in")); return; }
    els.forEach((el) => el.classList.add("sreveal"));
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.06, rootMargin: "0px 0px -7% 0px" });
    els.forEach((el) => io.observe(el));
  }

  function headerHTML(t) {
    const tmdbUrl = t.tmdbId ? `https://www.themoviedb.org/${t.type}/${t.tmdbId}` : null;
    const live = tmdbUrl
      ? `<a class="tag tag--live" href="${tmdbUrl}" target="_blank" rel="noopener noreferrer" title="View on TMDB">TMDB ↗</a>`
      : "";
    const shareBtn = `
      <button class="sharebtn" id="shareBtn" type="button" aria-label="Share a summary card">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v13M12 3l-4 4M12 3l4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>Share</span>
      </button>`;
    return `
      <header class="rhead">
        <div class="rhead__postercol">
          <div class="rhead__poster" style="${posterStyle(t)}">${posterInner(t, true)}</div>
        </div>
        <div class="rhead__main">
          ${shareBtn}
          <div class="rhead__kicker">
            ${live}
            <span class="tag tag--cert">${t.cert || "NR"}</span>
            <span class="tag tag--type">${t.type === "tv" ? "TV Series" : "Film"}</span>
            ${t.year ? `<span class="tag">${t.year}</span>` : ""}
            ${t.runtime ? `<span class="tag">${fmtTime(t.runtime)}${t.type === "tv" ? " / ep" : ""}</span>` : ""}
          </div>
          <h2 class="rhead__title">${t.title}</h2>
          ${t.tagline ? `<p class="rhead__tagline">“${t.tagline}”</p>` : ""}
          <div class="rhead__genres">${(t.genres || []).map((g) => `<span class="genre">${g}</span>`).join("")}</div>
        </div>
      </header>`;
  }

  function verdictHTML(t, nud, hasTs) {
    const dtddLink = t.dtddUrl
      ? ` <a class="verdict__src" href="${t.dtddUrl}" target="_blank" rel="noopener noreferrer">DoesTheDogDie ↗</a>` : "";
    const v = t.nudityVotes;
    if (nud) {
      const kw = t.nudityKeywords && t.nudityKeywords.length
        ? ` <span class="verdict__kw">${t.nudityKeywords.slice(0, 3).join(" · ")}</span>` : "";
      const ts = hasTs
        ? `<b>${t.advisories.filter((a) => a.category === "nudity").length} timestamped</b> below.`
        : `No frame-accurate timecodes are available — see the sources below.`;
      let basis = "";
      if (t.nuditySource === "dtdd" && v) basis = ` <span class="verdict__basis">Confirmed by community votes — ${v.yes}✓ / ${v.no}✗.${dtddLink}</span>`;
      else if (t.nuditySource === "tmdb") basis = ` <span class="verdict__basis">Flagged by TMDB keyword tags.</span>`;
      return `
        <div class="verdict verdict--flag">
          <span class="verdict__dot"></span>
          <p class="verdict__text"><strong>Contains nudity / sexual content.</strong> ${ts}
          We've surfaced <strong>same-genre picks with no nudity flagged</strong>.${basis} ${kw}</p>
        </div>`;
    }
    if (nudityKnown(t)) {
      let basis;
      if (t.nuditySource === "dtdd" && v) basis = `Confirmed clear by community votes — ${v.no}✗ / ${v.yes}✓.${dtddLink}`;
      else basis = "None in our verified log.";
      return `
        <div class="verdict verdict--clear">
          <span class="verdict__dot"></span>
          <p class="verdict__text"><strong>No nudity.</strong> ${basis}
          ${hasTs ? " Other advisories are timestamped below." : ""}</p>
        </div>`;
    }
    return `
      <div class="verdict verdict--unknown">
        <span class="verdict__dot"></span>
        <p class="verdict__text"><strong>Nudity unconfirmed.</strong> No nudity tag on TMDB and no
        community verdict on DoesTheDogDie yet — so this is <em>not</em> a guarantee of none.
        The <strong>IMDb Parents Guide</strong> (linked below) is the reliable yes/no.</p>
      </div>`;
  }

  // when we have timestamped nudity advisories, surface them up top, before the summary
  function nudityFirstHTML(advisories) {
    const nt = advisories
      .filter((a) => a.category === "nudity" && typeof a.t === "number")
      .sort((a, b) => a.t - b.t);
    if (!nt.length) return "";
    const rows = nt.map((a) => `
      <div class="nudts__row">
        <span class="nudts__time mono">${fmtTime(a.t)}</span>
        <div class="nudts__body"><span class="nudts__note">${a.note}</span></div>
        <span class="nudts__sev">${SEVERITY[a.severity].label}</span>
      </div>`).join("");
    return `
      <section class="nudts" style="--cat:${CATEGORIES.nudity.color}">
        <div class="nudts__head"><span class="nudts__glyph">${CATEGORIES.nudity.glyph}</span>
          <h3>Nudity &amp; sexual content — when</h3>
          <span class="nudts__count mono">${nt.length} scene${nt.length > 1 ? "s" : ""}</span></div>
        <div class="nudts__list">${rows}</div>
      </section>`;
  }

  function summaryHTML(byCat, usedCats, total, hasTimestamps) {
    const cards = usedCats.map((c) => {
      const meta = CATEGORIES[c];
      const items = byCat[c];
      const maxSev = Math.max(...items.map((a) => a.severity));
      const dots = [1, 2, 3].map((n) => `<span class="sevdot ${n <= maxSev ? "on" : ""}"></span>`).join("");
      return `
        <div class="catcard" style="--cat:${meta.color}">
          <div class="catcard__top"><span class="catcard__glyph">${meta.glyph}</span><span class="catcard__label">${meta.label}</span></div>
          <div class="catcard__count" data-count="${items.length}">0</div>
          <div class="catcard__sev">${dots}</div>
        </div>`;
    }).join("");
    return `
      <section class="summary collapsible">
        <div class="summary__head ssec-head" role="button" tabindex="0" aria-expanded="true">
          <div class="ssec-head__l"><h3>Advisory summary</h3>
            <span class="summary__total mono">${total} ${hasTimestamps ? "timestamped " : ""}notices · ${usedCats.length} categories</span></div>
          ${collapseChevron()}
        </div>
        <div class="collapse-wrap"><div class="collapse-inner">
          <div class="cats">${cards}</div>
        </div></div>
      </section>`;
  }

  function collapseChevron() {
    return `<span class="collapse-toggle" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  }

  function timelineHTML(t, sorted, usedCats) {
    const legend = usedCats.map((c) => {
      const m = CATEGORIES[c];
      return `<span class="legend" style="--cat:${m.color}"><i></i>${m.label}</span>`;
    }).join("");
    const lanes = usedCats.map((c) => {
      const m = CATEGORIES[c];
      const markers = sorted.filter((a) => a.category === c).map((a) => {
        const pct = (a.t / t.runtime) * 100;
        const delay = reduce ? 0 : (a.t / t.runtime) * 0.5 + 0.1;
        return `<button class="marker" data-sev="${a.severity}" data-t="${a.t}"
                  style="left:${pct}%;--cat:${m.color};--d:${delay.toFixed(2)}s"
                  aria-label="${m.label} at ${fmtTime(a.t)}: ${a.note}"></button>`;
      }).join("");
      return `
        <div class="lane" style="--cat:${m.color}">
          <span class="lane__name">${m.label.split(" ")[0]}</span>
          <div class="lane__track"></div>${markers}
        </div>`;
    }).join("");
    return `
      <section class="timeline">
        <div class="timeline__head"><h3>Scene timeline</h3><div class="timeline__legend">${legend}</div></div>
        <div class="scrubwrap">
          <div class="timecode-readout mono">▶ <b id="tcNow">0:00</b> / ${fmtTime(t.runtime)}
            <span id="tcNear" style="color:var(--ink-dim)"></span></div>
          <div class="lanes" id="lanes">${lanes}
            <div class="playhead" id="playhead"><div class="playhead__line"></div>
              <div class="playhead__grip" id="grip" role="slider" tabindex="0" aria-label="Scrub timeline"
                   aria-valuemin="0" aria-valuemax="${t.runtime}" aria-valuenow="0"></div></div>
          </div>
          <div class="axis"><span>0:00</span><span>${fmtTime(t.runtime/4)}</span><span>${fmtTime(t.runtime/2)}</span>
            <span>${fmtTime(t.runtime*3/4)}</span><span>${fmtTime(t.runtime)}</span></div>
          <div class="tip" id="tip"></div>
        </div>
      </section>`;
  }

  function cueListHTML(sorted, usedCats, hasTimestamps) {
    const filters = `<button class="filter is-active" data-cat="all">All</button>` +
      usedCats.map((c) => { const m = CATEGORIES[c];
        return `<button class="filter" data-cat="${c}" style="--cat:${m.color}"><i></i>${m.label}</button>`; }).join("");
    const rows = sorted.map((a) => {
      const m = CATEGORIES[a.category];
      const dots = [1, 2, 3].map((n) => `<span class="cue__sevdot ${n <= a.severity ? "on" : ""}"></span>`).join("");
      const lead = typeof a.t === "number"
        ? `<span class="cue__time mono">${fmtTime(a.t)}</span>`
        : `<span class="cue__time cue__sevtag" data-sev="${a.severity}">${SEVERITY[a.severity].label}</span>`;
      return `
        <div class="cue" data-cat="${a.category}" ${typeof a.t === "number" ? `data-t="${a.t}"` : ""} style="--cat:${m.color}">
          ${lead}
          <span class="cue__icon">${m.glyph}</span>
          <div class="cue__body"><span class="cue__cat">${m.label} · ${SEVERITY[a.severity].label}</span>
            <p class="cue__note">${a.note}${a.votes ? ` <span class="cue__votes">${a.votes.yes}✓</span>` : ""}</p></div>
          <span class="cue__sev">${dots}</span>
        </div>`;
    }).join("");
    const head = hasTimestamps ? "Every notice, in order" : "What you should know";
    const sub = hasTimestamps ? "" :
      `<p class="cuelist__sub">Community-flagged content from DoesTheDogDie — no scene timecodes on the free tier, so these aren't time-ordered.</p>`;
    return `
      <section class="cuelist collapsible">
        <div class="cuelist__head">
          <div class="ssec-head ssec-head--inline" role="button" tabindex="0" aria-expanded="true">
            <h3>${head}</h3>${collapseChevron()}
          </div>
          <div class="filters">${filters}</div>
        </div>
        <div class="collapse-wrap"><div class="collapse-inner">
          ${sub}
          <div class="cues" id="cues">${rows}</div>
        </div></div>
      </section>`;
  }

  function noTimestampsHTML(t, nud) {
    return `
      <section class="notimes">
        <div class="notimes__icon">🔎</div>
        <h3>No detailed advisories for this title yet</h3>
        <p>It isn't in the community database, so there's nothing crowd-verified to show.
        The sources below are the best place to check by hand.</p>
      </section>`;
  }

  function sourcesHTML(t) {
    const titleYear = t.title + (t.year ? ` ${t.year}` : "");
    const g = (extra) => `https://www.google.com/search?q=${encodeURIComponent(titleYear + " " + extra)}`;
    const imdb = t.imdb_id
      ? `https://www.imdb.com/title/${t.imdb_id}/parentalguide`
      : `https://www.imdb.com/find/?q=${encodeURIComponent(t.title)}&s=tt`;
    const dtdd = t.dtddUrl || g("site:doesthedogdie.com");
    const links = [
      ["IMDb Parents Guide", imdb, "severity levels (no timecodes)"],
      ["Does the Dog Die?", dtdd, t.dtddUrl ? "crowd nudity votes — this title" : "crowd content votes"],
      ["Unconsented", `https://www.unconsentingmedia.org/?s=${encodeURIComponent(t.title)}`, "crowd scene timecodes"],
      ["Reddit", `https://www.reddit.com/search/?q=${encodeURIComponent(t.title + " nudity scene")}`, "community threads"],
      ["Web search", g("nudity scene timestamp"), "everything else"],
    ];
    return `
      <section class="sources">
        <h3>Find scene-level timestamps</h3>
        <p class="sources__sub">No API returns frame-accurate timecodes — these open a search for
          <strong>${t.title}</strong> on the sources that crowd-source them.</p>
        <div class="sources__grid">
          ${links.map(([name, href, note]) => `
            <a class="source" href="${href}" target="_blank" rel="noopener noreferrer">
              <span class="source__name">${name} <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              <span class="source__note">${note}</span>
            </a>`).join("")}
        </div>
      </section>`;
  }

  function recsHTML(title, nud) {
    let items; // normalized: {key, title, year, cert, type, poster, overlap, shared, tmdbId}
    const isLive = !!(title.tmdbRecs && title.tmdbRecs.length);
    if (isLive) {
      items = title.tmdbRecs.map((r) => ({
        key: "tmdb-" + r.type + "-" + r.id, tmdbId: r.id, type: r.type,
        title: r.title, year: r.year, cert: r.cert, poster: r.poster,
        overlap: r.overlap, shared: (r.genres || []).filter((g) => title.genres.includes(g)),
      }));
    } else {
      items = localRecommend(title).map(({ t, overlap, shared }) => ({
        key: t.id, localId: t.id, type: t.type, title: t.title, year: t.year,
        cert: t.cert, poster: t.poster || null, _t: t, overlap, shared,
      }));
    }
    if (!items.length) return "";
    // live recs are filtered on TMDB tags (sparse) -> "not flagged"; curated recs are reliable
    const badge = isLive ? "NO TAGGED NUDITY" : "NO NUDITY ✓";
    const pill = isLive ? "NOT FLAGGED" : "NO NUDITY";
    const caveat = isLive ? " <em>(TMDB tags are sparse — verify via the sources above.)</em>" : "";
    const head = nud
      ? `<div class="recs__head"><h3>${isLive ? "Same-genre, none flagged" : "Clean picks, same genre"}</h3><span class="recs__badge">${badge}</span></div>
         <p class="recs__sub">Because <strong>${title.title}</strong> contains nudity, here are same-genre titles ${isLive ? "with no nudity tagged on TMDB" : "with none in our verified log"}.${caveat}</p>`
      : `<div class="recs__head"><h3>More like this</h3><span class="recs__badge">${badge}</span></div>
         <p class="recs__sub">Same-genre titles ${isLive ? "with no nudity flagged on TMDB" : "also clear of nudity"}.${caveat}</p>`;
    const cards = items.map((r) => `
      <button class="rec" data-key="${r.key}" ${r.tmdbId ? `data-tmdb-id="${r.tmdbId}" data-tmdb-type="${r.type}"` : ""} ${r.localId ? `data-local-id="${r.localId}"` : ""}>
        <div class="rec__poster" style="${posterStyle(r)}">${posterInner(r)}<span class="rec__clean">${pill}</span></div>
        <div class="rec__body">
          <span class="rec__title">${r.title}</span>
          <span class="rec__meta">${[r.year, r.cert, r.type === "tv" ? "TV" : "Film"].filter(Boolean).join(" · ")}</span>
        </div>
      </button>`).join("");
    return `<section class="recs">${head}<div class="recgrid">${cards}</div></section>`;
  }

  function notFoundHTML(query) {
    const sugg = DATA.slice(0, 6).map((t) => `<button class="chip" data-id="${t.id}">${t.title}</button>`).join("");
    const note = LIVE
      ? `TMDB has no movie or TV match for “${query}”. Check the spelling, or try one of these:`
      : `Live search isn't configured, so MovieFilterr is running on its curated set — “${query}” isn't in it. Try one of these:`;
    return `
      <article class="rcard">
        <div class="empty"><div class="empty__glyph">🎞️</div>
          <h3>No match for “${query}”</h3><p>${note}</p>
          <div class="empty__sugg">${sugg}</div>
        </div>
      </article>`;
  }

  function errorHTML() {
    return `
      <article class="rcard">
        <div class="empty"><div class="empty__glyph">⚠️</div>
          <h3>Something went wrong reading that title</h3>
          <p>The data service hiccuped. Give it another try in a moment.</p>
        </div>
      </article>`;
  }

  /* ----------------------- timeline interactivity ------------------------ */
  function wireTimeline(title, sorted) {
    const lanes = $("#lanes");
    const grip = $("#grip");
    const playLine = $(".playhead__line");
    const tip = $("#tip");
    const tcNow = $("#tcNow");
    const tcNear = $("#tcNear");
    const markers = $$(".marker", lanes);
    if (!lanes || !grip) return;
    const trackRect = () => $(".lane__track").getBoundingClientRect();

    function setPlayhead(pct) {
      pct = Math.min(100, Math.max(0, pct));
      playLine.style.left = pct + "%";
      grip.style.left = pct + "%";
      const sec = (pct / 100) * title.runtime;
      grip.setAttribute("aria-valuenow", Math.round(sec));
      tcNow.textContent = fmtTime(sec);
      let nearest = null, nd = Infinity;
      markers.forEach((mk) => {
        const mt = +mk.dataset.t, d = Math.abs(mt - sec);
        mk.classList.toggle("is-near", d < title.runtime * 0.03);
        if (d < nd) { nd = d; nearest = mk; }
      });
      if (nearest && nd < title.runtime * 0.05) {
        const a = sorted.find((x) => x.t === +nearest.dataset.t);
        tcNear.textContent = `· near: ${a.note.slice(0, 46)}${a.note.length > 46 ? "…" : ""}`;
      } else tcNear.textContent = "";
    }

    let dragging = false;
    const pctFromX = (x) => { const r = trackRect(); return ((x - r.left) / r.width) * 100; };
    const onMove = (e) => { if (!dragging) return; const x = e.touches ? e.touches[0].clientX : e.clientX; setPlayhead(pctFromX(x)); };
    const startDrag = (e) => { dragging = true; document.body.style.userSelect = "none"; onMove(e); };
    const endDrag = () => { dragging = false; document.body.style.userSelect = ""; };
    grip.addEventListener("mousedown", startDrag);
    grip.addEventListener("touchstart", startDrag, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
    lanes.addEventListener("click", (e) => {
      if (e.target.classList.contains("marker")) return;
      const r = trackRect(); if (e.clientX < r.left) return; setPlayhead(pctFromX(e.clientX));
    });
    grip.addEventListener("keydown", (e) => {
      const cur = +grip.getAttribute("aria-valuenow"), step = title.runtime * 0.02; let next = cur;
      if (e.key === "ArrowRight") next = cur + step; else if (e.key === "ArrowLeft") next = cur - step;
      else if (e.key === "Home") next = 0; else if (e.key === "End") next = title.runtime; else return;
      e.preventDefault(); setPlayhead((next / title.runtime) * 100);
    });

    function showTip(mk) {
      const a = sorted.find((x) => x.t === +mk.dataset.t); if (!a) return;
      const meta = CATEGORIES[a.category];
      const lr = lanes.getBoundingClientRect(), mr = mk.getBoundingClientRect();
      tip.style.setProperty("--cat", meta.color);
      tip.innerHTML = `<span class="tip__time mono">${fmtTime(a.t)}</span><span class="tip__cat" style="color:${meta.color}">${meta.label}</span><p class="tip__note">${a.note}</p>`;
      tip.style.left = (mr.left - lr.left + mr.width / 2) + "px";
      tip.style.top = (mr.top - lr.top) + "px";
      tip.classList.add("is-on");
    }
    const hideTip = () => tip.classList.remove("is-on");
    markers.forEach((mk) => {
      mk.addEventListener("mouseenter", () => showTip(mk));
      mk.addEventListener("mouseleave", hideTip);
      mk.addEventListener("focus", () => showTip(mk));
      mk.addEventListener("blur", hideTip);
      mk.addEventListener("click", () => setPlayhead((+mk.dataset.t / title.runtime) * 100));
    });
    setPlayhead(0);
  }

  function wireFilters() {
    const btns = $$(".filter"), cues = $$(".cue");
    btns.forEach((btn) => btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const cat = btn.dataset.cat;
      cues.forEach((c) => c.classList.toggle("is-hidden", cat !== "all" && c.dataset.cat !== cat));
    }));
  }

  function wireCollapse() {
    $$(".ssec-head", result).forEach((head) => {
      const sec = head.closest(".collapsible");
      const toggle = () => {
        const collapsed = sec.classList.toggle("is-collapsed");
        head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      };
      head.addEventListener("click", (e) => { if (e.target.closest("a, .filter")) return; toggle(); });
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
  }

  function wireRecClicks() {
    $$(".rec", result).forEach((card) => {
      card.addEventListener("click", () => {
        if (card.dataset.tmdbId) resolveAndRender(card.dataset.tmdbType, card.dataset.tmdbId);
        else if (card.dataset.localId) {
          const t = DATA.find((x) => x.id === card.dataset.localId);
          if (t) { $("#searchInput").value = t.title; render(t); }
        }
      });
    });
    $$(".empty__sugg .chip", result).forEach((chip) => {
      chip.addEventListener("click", () => {
        const t = DATA.find((x) => x.id === chip.dataset.id);
        if (t) { $("#searchInput").value = t.title; render(t); }
      });
    });
  }

  function countUp() {
    if (reduce) { $$(".catcard__count").forEach((el) => (el.textContent = el.dataset.count)); return; }
    $$(".catcard__count").forEach((el) => {
      const target = +el.dataset.count; let n = 0;
      const step = Math.max(1, Math.ceil(target / 14));
      const tick = () => { n = Math.min(target, n + step); el.textContent = n; if (n < target) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }

  /* --------------------- share a summary card image --------------------- */
  function slug(s) { return (s || "title").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // shareable deep link that re-opens this exact title
  function titleLink(t) {
    const base = "https://moviefilterr.vercel.app/";
    if (t.tmdbId) return `${base}?id=${t.type}-${t.tmdbId}`;
    return `${base}?q=${encodeURIComponent(t.title)}`;
  }

  function shareSummaryText(t) {
    const nud = nudityOf(t);
    const verdict = nud ? "⚠ Contains nudity/sex" : nudityKnown(t) ? "✓ No nudity" : "Nudity unconfirmed";
    const cats = [...new Set((t.advisories || []).map((a) => CATEGORIES[a.category].label))];
    const extra = cats.length ? ` · Flagged: ${cats.slice(0, 4).join(", ")}` : "";
    return `${t.title}${t.year ? ` (${t.year})` : ""} — ${verdict}${extra}. Know before you watch → ${titleLink(t)}`;
  }

  function loadShareImage(url) {
    return new Promise((res) => {
      if (!url) return res(null);
      const img = new Image(); img.crossOrigin = "anonymous";
      let done = false; const finish = (v) => { if (!done) { done = true; res(v); } };
      img.onload = () => finish(img); img.onerror = () => finish(null);
      img.src = "/api/img?u=" + encodeURIComponent(url); // same-origin proxy -> un-tainted canvas
      setTimeout(() => finish(null), 4500);
    });
  }

  async function buildShareImage(t) {
    const W = 1080, H = 1350, P = 80;
    const poster = await loadShareImage(t.poster);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d");
    const light = document.documentElement.getAttribute("data-theme") === "light";

    const bg = x.createLinearGradient(0, 0, W, H);
    if (light) { bg.addColorStop(0, "#f3f1ec"); bg.addColorStop(1, "#dbeee8"); }
    else { bg.addColorStop(0, "#0a0f0e"); bg.addColorStop(1, "#0b0b12"); }
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(W, 0, 0, W, 0, 820);
    glow.addColorStop(0, "rgba(45,212,191,.28)"); glow.addColorStop(1, "rgba(45,212,191,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    const ink = light ? "#1a1822" : "#f4f1ea";
    const dim = light ? "#6b6776" : "#9b97a8";
    const panel = light ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.05)";
    const rr = (cx, cy, cw, ch, r) => { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + cw, cy, cx + cw, cy + ch, r); x.arcTo(cx + cw, cy + ch, cx, cy + ch, r); x.arcTo(cx, cy + ch, cx, cy, r); x.arcTo(cx, cy, cx + cw, cy, r); x.closePath(); };
    const F = (px, w) => `${w || 700} ${px}px "Nightingale", system-ui, sans-serif`;
    const FH = (px, w) => `${w || 700} ${px}px "Life Cinema Screen", system-ui, sans-serif`;
    const cover = (img, dx, dy, dw, dh) => {
      const ir = img.width / img.height, dr = dw / dh; let sw, sh, sx, sy;
      if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
      else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
      x.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    x.textBaseline = "alphabetic";
    // brand
    x.font = FH(48, 700); x.fillStyle = ink; x.fillText("Movie", P, 116);
    const mW = x.measureText("Movie").width;
    const tg = x.createLinearGradient(P + mW, 86, P + mW + 240, 126);
    tg.addColorStop(0, "#2dd4bf"); tg.addColorStop(1, "#10b981");
    x.fillStyle = tg; x.fillText("Filterr", P + mW, 116);
    x.font = F(23, 600); x.fillStyle = dim; x.fillText("KNOW EVERY SCENE BEFORE IT PLAYS", P, 152);

    // poster
    const px0 = P, py0 = 200, pw = 320, ph = 480;
    x.save(); rr(px0, py0, pw, ph, 22); x.clip();
    if (poster) cover(poster, px0, py0, pw, ph);
    else {
      const pg = x.createLinearGradient(px0, py0, px0 + pw, py0 + ph);
      pg.addColorStop(0, "#16413b"); pg.addColorStop(1, "#0c2a27"); x.fillStyle = pg; x.fillRect(px0, py0, pw, ph);
      x.fillStyle = "rgba(255,255,255,.85)"; x.font = FH(116, 700); x.textAlign = "center";
      x.fillText(initials(t), px0 + pw / 2, py0 + ph / 2 + 38); x.textAlign = "left";
    }
    x.restore();
    rr(px0, py0, pw, ph, 22); x.lineWidth = 2; x.strokeStyle = light ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.14)"; x.stroke();

    // right column
    const tx = px0 + pw + 46, tw = W - tx - P;
    const nud = nudityOf(t), vKnown = nudityKnown(t);
    const vColor = nud ? "#ff5d8f" : vKnown ? "#10b981" : "#6ec1ff";
    const vText = nud ? "CONTAINS NUDITY/SEX" : vKnown ? "NO NUDITY" : "UNCONFIRMED";
    let ty = py0 + 16;
    x.font = F(24, 700); const pillW = Math.min(x.measureText(vText).width + 76, tw);
    rr(tx, ty, pillW, 56, 28); x.fillStyle = panel; x.fill();
    x.beginPath(); x.arc(tx + 32, ty + 28, 11, 0, 7); x.fillStyle = vColor; x.fill();
    x.fillStyle = ink; x.fillText(vText, tx + 54, ty + 37); ty += 92;
    if (t.nudityVotes) { x.font = F(22, 500); x.fillStyle = dim; x.fillText(`community ${t.nudityVotes.yes}✓ / ${t.nudityVotes.no}✗`, tx, ty); ty += 38; }
    // title (wrapped)
    x.fillStyle = ink; x.font = FH(60, 700);
    const words = t.title.split(" "); let line = ""; const lines = [];
    for (const w of words) { const test = line ? line + " " + w : w; if (x.measureText(test).width > tw && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line);
    ty += 22;
    for (const ln of lines.slice(0, 4)) { x.fillText(ln, tx, ty); ty += 66; }
    x.font = F(26, 600); x.fillStyle = dim;
    x.fillText([t.year, t.cert, t.type === "tv" ? "TV" : "Film"].filter(Boolean).join("   ·   "), tx, ty + 2);

    // lower section
    let y = Math.max(py0 + ph, ty) + 72;
    const byCat = {}; (t.advisories || []).forEach((a) => (byCat[a.category] = (byCat[a.category] || 0) + 1));
    const cats = Object.keys(CATEGORIES).filter((c) => byCat[c]);
    let cx = P;
    cats.forEach((c) => {
      const label = `${CATEGORIES[c].label}  ${byCat[c]}`;
      x.font = F(25, 600); const w = x.measureText(label).width + 54;
      if (cx + w > W - P) { cx = P; y += 60; }
      rr(cx, y, w, 46, 23); x.fillStyle = panel; x.fill();
      x.beginPath(); x.arc(cx + 24, y + 23, 7, 0, 7); x.fillStyle = CATEGORIES[c].color; x.fill();
      x.fillStyle = ink; x.fillText(label, cx + 42, y + 31); cx += w + 14;
    });
    y += 92;

    const adv = [...(t.advisories || [])].sort((a, b) => b.severity - a.severity).slice(0, 5);
    if (adv.length) {
      x.font = F(24, 700); x.fillStyle = dim; x.fillText("WHAT TO KNOW", P, y); y += 46;
      adv.forEach((a) => {
        x.beginPath(); x.arc(P + 8, y - 9, 7, 0, 7); x.fillStyle = CATEGORIES[a.category].color; x.fill();
        x.font = F(30, 500); x.fillStyle = ink;
        let note = a.note; while (x.measureText(note).width > W - P * 2 - 40 && note.length > 8) note = note.slice(0, -6) + "…";
        x.fillText(note, P + 34, y); y += 54;
      });
    }

    // footer
    x.font = F(26, 700); x.fillStyle = "#2dd4bf"; x.fillText("moviefilterr.vercel.app", P, H - 72);
    x.textAlign = "right"; x.fillStyle = dim; x.font = F(22, 500);
    x.fillText("data: TMDB · DoesTheDogDie", W - P, H - 72); x.textAlign = "left";

    return await new Promise((res) => cv.toBlob((b) => res(b), "image/png", 0.95));
  }

  function wireShare(t) {
    const btn = $("#shareBtn", result); if (!btn) return;
    btn.addEventListener("click", async () => {
      const lbl = btn.querySelector("span"); const old = lbl.textContent;
      btn.disabled = true; lbl.textContent = "…";
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const blob = await buildShareImage(t);
        const file = new File([blob], `${slug(t.title)}-moviefilterr.png`, { type: "image/png" });
        const text = shareSummaryText(t);
        const url = titleLink(t);
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${t.title} — MovieFilterr`, text, url });
        } else if (navigator.share) {
          await navigator.share({ title: `${t.title} — MovieFilterr`, text, url });
        } else {
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
          a.download = file.name; document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          lbl.textContent = "Saved ✓"; setTimeout(() => (lbl.textContent = old), 1600); return;
        }
      } catch (e) { /* cancelled */ }
      finally { btn.disabled = false; if (lbl.textContent === "…") lbl.textContent = old; }
    });
  }

  /* -------------------------- resolve + dispatch ------------------------- */
  async function resolveAndRender(type, id) {
    showLoading("Reading the scene log…");
    try {
      const p = await apiTitle(type, id);
      if (!p || !p.live || !p.title) throw new Error("no detail");
      const adapted = adaptTmdb(p);
      $("#searchInput").value = adapted.title;
      render(adapted);
    } catch (e) { showResult(errorHTML()); }
  }

  async function runQuery(query) {
    const q = query.trim();
    if (!q) return;
    if (LIVE) {
      showLoading("Searching TMDB…");
      try {
        const results = await apiSearch(q);
        if (results.length) { await resolveAndRender(results[0].type, results[0].id); return; }
      } catch {}
      // live had no hit — try curated before declaring not-found
      const local = localBest(q);
      if (local) { render(local); return; }
      showResult(notFoundHTML(q));
      wireRecClicks();
      return;
    }
    const local = localBest(q);
    if (local) render(local);
    else { showResult(notFoundHTML(q)); wireRecClicks(); }
  }

  /* ------------------------------- search UI ----------------------------- */
  function wireSearch() {
    const form = $("#searchForm"), input = $("#searchInput"), suggest = $("#suggest");
    let items = [], activeIdx = -1, debounceT = null, seq = 0;

    function renderSuggest(list) {
      items = list;
      if (!list.length) {
        suggest.innerHTML = `<li class="suggest__empty">${LIVE ? "No match — press Enter to search." : "No match in library — press Enter for suggestions."}</li>`;
        suggest.classList.add("is-open"); input.setAttribute("aria-expanded", "true"); return;
      }
      suggest.innerHTML = list.map((it, i) => {
        const isLive = !!it.tmdbType || it._live;
        const sub = it.year ? `${it.year}${it.genresLabel ? " · " + it.genresLabel : ""}` : (it.genresLabel || "");
        return `
          <li class="suggest__item ${i === activeIdx ? "is-active" : ""}" role="option" data-idx="${i}">
            <span class="suggest__poster" style="${posterStyle(it)}">${it.poster ? `<img class="pimg" src="${it.poster}" alt="" loading="lazy">` : ""}</span>
            <span class="suggest__meta"><span class="suggest__title">${it.title}</span><span class="suggest__sub">${sub}</span></span>
            ${it.flag ? `<span class="suggest__flag" style="color:${it.flagColor}">${it.flag}</span>` : `<span class="suggest__flag" style="color:var(--ink-dim)">${it.type === "tv" ? "TV" : "Film"}</span>`}
          </li>`;
      }).join("");
      suggest.classList.add("is-open"); input.setAttribute("aria-expanded", "true");
      $$(".suggest__item", suggest).forEach((li) => li.addEventListener("click", () => choose(+li.dataset.idx)));
    }
    function closeSuggest() { suggest.classList.remove("is-open"); input.setAttribute("aria-expanded", "false"); activeIdx = -1; }

    function choose(idx) {
      const it = items[idx]; if (!it) return;
      input.value = it.title; closeSuggest();
      if (it.tmdbType) resolveAndRender(it.tmdbType, it.id);
      else if (it._localRef) render(it._localRef);
      else runQuery(it.title);
    }

    function localSuggestItems(q) {
      return localSearch(q).map((t) => {
        const nud = nudityOf(t);
        return { id: t.id, title: t.title, year: t.year, type: t.type,
          genresLabel: t.genres.slice(0, 2).join(", "), poster: t.poster || null, _localRef: t,
          flag: nud ? "◐ nudity" : "✓ clean", flagColor: nud ? "var(--c-nudity)" : "var(--c-substances)" };
      });
    }

    async function onInput() {
      const q = input.value.trim(); activeIdx = -1;
      if (!q) { closeSuggest(); return; }
      if (!LIVE) { renderSuggest(localSuggestItems(q)); return; }
      const mySeq = ++seq;
      // show local instantly, then replace with live results
      renderSuggest(localSuggestItems(q));
      const res = await apiSearch(q);
      if (mySeq !== seq) return; // stale
      if (res.length) {
        renderSuggest(res.slice(0, 6).map((r) => ({
          id: r.id, title: r.title, year: r.year, type: r.type, tmdbType: r.type,
          poster: r.poster, genresLabel: "", _live: true,
        })));
      }
    }

    input.addEventListener("input", () => { clearTimeout(debounceT); debounceT = setTimeout(onInput, 180); });
    input.addEventListener("focus", () => { if (input.value.trim()) onInput(); });
    input.addEventListener("keydown", (e) => {
      if (!suggest.classList.contains("is-open")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); renderSuggest(items); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); renderSuggest(items); }
      else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); choose(activeIdx); }
      else if (e.key === "Escape") closeSuggest();
    });
    document.addEventListener("click", (e) => { if (!form.contains(e.target)) closeSuggest(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); closeSuggest(); runQuery(input.value); });

    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== input) { e.preventDefault(); input.focus(); input.select(); }
    });
    $("#focusSearch")?.addEventListener("click", () => { input.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }

  /* ------------------------------ quick chips ---------------------------- */
  function buildChips() {
    const wrap = $("#quickChips"); if (!wrap) return;
    const picks = ["Titanic", "The Dark Knight", "Game of Thrones", "Parasite", "Coco", "The Boys"];
    wrap.innerHTML = picks.map((p) => `<button class="chip" data-q="${p}">${p}</button>`).join("");
    $$(".chip", wrap).forEach((c) => c.addEventListener("click", () => {
      $("#searchInput").value = c.dataset.q; runQuery(c.dataset.q);
    }));
  }

  /* ------------------------------- library ------------------------------- */
  function buildLibrary() {
    const grid = $("#libraryGrid"); if (!grid) return;
    grid.innerHTML = DATA.map((t) => {
      const nud = nudityOf(t);
      const sevBars = [...new Set(t.advisories.map((a) => a.category))]
        .map((c) => `<span class="dotsev" style="--cat:${CATEGORIES[c].color}"></span>`).join("");
      return `
        <button class="libcard" data-id="${t.id}">
          <div class="libcard__poster" style="${posterStyle(t)}">${posterInner(t)}
            <span class="libcard__flag">${sevBars}</span></div>
          <div class="libcard__body"><span class="libcard__title">${t.title}</span>
            <span class="libcard__meta">${t.year} · ${t.cert} · ${t.type === "tv" ? "TV" : "Film"}</span>
            <span class="libcard__nud ${nud ? "nud-yes" : "nud-no"}"><i></i>${nud ? "Contains nudity" : "No nudity"}</span></div>
        </button>`;
    }).join("");
    $$(".libcard", grid).forEach((card) => card.addEventListener("click", () => {
      const t = DATA.find((x) => x.id === card.dataset.id);
      if (t) { $("#searchInput").value = t.title; render(t); }
    }));
  }

  /* ------------------------- scroll reveal + topbar ---------------------- */
  function wireReveals() {
    const topbar = $("#topbar");
    window.addEventListener("scroll", () => topbar.classList.toggle("is-stuck", window.scrollY > 10), { passive: true });
    if (reduce || !("IntersectionObserver" in window)) { $$(".how__card, .libcard").forEach((el) => el.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        const el = e.target, sibs = Array.from(el.parentElement.children);
        el.style.transitionDelay = (sibs.indexOf(el) % 8) * 60 + "ms";
        el.classList.add("in"); io.unobserve(el);
      }
    }), { threshold: 0.12 });
    $$(".how__card, .libcard").forEach((el) => io.observe(el));
  }

  /* ----------------------------- theme toggle ---------------------------- */
  function wireThemeToggle() {
    const btn = $("#themeToggle");
    if (!btn) return;
    const root = document.documentElement;
    const KEY = "mf-theme";
    const sync = () => btn.setAttribute("aria-pressed", root.getAttribute("data-theme") === "light" ? "true" : "false");
    sync();
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      const apply = () => { root.setAttribute("data-theme", next); try { localStorage.setItem(KEY, next); } catch (e) {} sync(); };
      // animated circular reveal from the toggle, where supported
      if (document.startViewTransition && !reduce) {
        const r = btn.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        const vt = document.startViewTransition(apply);
        vt.ready.then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
            { duration: 540, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" }
          );
        });
      } else apply();
    });
  }

  /* -------------------------------- init --------------------------------- */
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    // attach real TMDB posters to the curated library
    if (window.MOVIEFILTERR_POSTERS) DATA.forEach((t) => {
      const p = window.MOVIEFILTERR_POSTERS[t.id]; if (p) t.poster = p;
    });
    runIntro(); buildChips(); buildLibrary(); wireReveals(); wireThemeToggle();
    // wire search immediately (works in demo mode) so the input is never dead
    wireSearch();
    // then detect live mode and upgrade the UI; handlers read LIVE at event time
    await detectLive();
    const input = $("#searchInput");
    if (input) input.placeholder = LIVE
      ? "Search any movie or show — “Oppenheimer”, “The Bear”, “Saltburn”…"
      : "Try “Titanic”, “Stranger Things”, “Parasite”…";
    openFromUrl();
  }

  // shared deep links: ?id=movie-603 (exact) or ?q=The Matrix
  async function openFromUrl() {
    const p = new URLSearchParams(location.search);
    const id = p.get("id"), q = p.get("q");
    if (id) {
      const mm = id.match(/^(movie|tv)-(\d+)$/);
      if (mm && LIVE) { $("#searchInput").value = ""; resolveAndRender(mm[1], mm[2]); return; }
    }
    if (q) { $("#searchInput").value = q; runQuery(q); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
