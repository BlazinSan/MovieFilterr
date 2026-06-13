/* ============================================================================
   CUEPOINT — app logic
   Live mode: searches TMDB via /api/* (real nudity detection for ANY title).
   Fallback mode: curated dataset only (when no TMDB key is configured).
   ========================================================================== */
(function () {
  "use strict";

  const { DATA, CATEGORIES, SEVERITY } = window.CUEPOINT;
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
      advisories: cur ? cur.advisories : [],
      liveNudity: t.nudity,
      nudityKeywords: t.nudityKeywords || [],
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
    const sorted = [...(title.advisories || [])].sort((a, b) => a.t - b.t);
    const byCat = {};
    for (const a of sorted) (byCat[a.category] ||= []).push(a);
    const usedCats = Object.keys(CATEGORIES).filter((c) => byCat[c]);
    const hasTs = sorted.length > 0;

    result.innerHTML = `
      <article class="rcard">
        ${headerHTML(title)}
        ${verdictHTML(title, nud, hasTs)}
        ${hasTs ? summaryHTML(byCat, usedCats, sorted.length) : ""}
        ${hasTs ? timelineHTML(title, sorted, usedCats) : ""}
        ${hasTs ? cueListHTML(sorted, usedCats) : noTimestampsHTML(title, nud)}
        ${sourcesHTML(title)}
        ${recsHTML(title, nud)}
      </article>`;

    result.hidden = false;
    if (hasTs) { wireTimeline(title, sorted); wireFilters(); countUp(); }
    wireRecClicks();
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  function headerHTML(t) {
    const live = t.tmdbId ? `<span class="tag tag--live">TMDB ✓</span>` : "";
    return `
      <header class="rhead">
        <div class="rhead__poster" style="${posterStyle(t)}">${posterInner(t, true)}</div>
        <div class="rhead__main">
          <div class="rhead__kicker">
            <span class="tag tag--cert">${t.cert || "NR"}</span>
            <span class="tag tag--type">${t.type === "tv" ? "TV Series" : "Film"}</span>
            ${t.year ? `<span class="tag">${t.year}</span>` : ""}
            ${t.runtime ? `<span class="tag">${fmtTime(t.runtime)}${t.type === "tv" ? " / ep" : ""}</span>` : ""}
            ${live}
          </div>
          <h2 class="rhead__title">${t.title}</h2>
          ${t.tagline ? `<p class="rhead__tagline">“${t.tagline}”</p>` : ""}
          <div class="rhead__genres">${(t.genres || []).map((g) => `<span class="genre">${g}</span>`).join("")}</div>
        </div>
      </header>`;
  }

  function verdictHTML(t, nud, hasTs) {
    if (nud) {
      const kw = t.nudityKeywords && t.nudityKeywords.length
        ? ` <span class="verdict__kw">${t.nudityKeywords.slice(0, 4).join(" · ")}</span>` : "";
      const ts = hasTs
        ? `<b>${t.advisories.filter((a) => a.category === "nudity").length} timestamped</b> below.`
        : `No frame-accurate timecodes are available — see the sources below.`;
      return `
        <div class="verdict verdict--flag">
          <span class="verdict__dot"></span>
          <p class="verdict__text"><strong>Contains nudity / sexual content.</strong> ${ts}
          We've surfaced <strong>clean same-genre picks</strong> with none.${kw}</p>
        </div>`;
    }
    if (nudityKnown(t)) {
      return `
        <div class="verdict verdict--clear">
          <span class="verdict__dot"></span>
          <p class="verdict__text"><strong>No nudity detected.</strong>
          ${hasTs ? "Other advisories are timestamped below." : "No nudity keywords were flagged for this title."}</p>
        </div>`;
    }
    return `
      <div class="verdict verdict--unknown">
        <span class="verdict__dot"></span>
        <p class="verdict__text"><strong>Nudity status unconfirmed</strong> for this title — check the community sources below.</p>
      </div>`;
  }

  function summaryHTML(byCat, usedCats, total) {
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
      <section class="summary">
        <div class="summary__head"><h3>Advisory summary</h3>
          <span class="summary__total mono">${total} timestamped notices · ${usedCats.length} categories</span></div>
        <div class="cats">${cards}</div>
      </section>`;
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

  function cueListHTML(sorted, usedCats) {
    const filters = `<button class="filter is-active" data-cat="all">All</button>` +
      usedCats.map((c) => { const m = CATEGORIES[c];
        return `<button class="filter" data-cat="${c}" style="--cat:${m.color}"><i></i>${m.label}</button>`; }).join("");
    const rows = sorted.map((a) => {
      const m = CATEGORIES[a.category];
      const dots = [1, 2, 3].map((n) => `<span class="cue__sevdot ${n <= a.severity ? "on" : ""}"></span>`).join("");
      return `
        <div class="cue" data-cat="${a.category}" data-t="${a.t}" style="--cat:${m.color}">
          <span class="cue__time mono">${fmtTime(a.t)}</span>
          <span class="cue__icon">${m.glyph}</span>
          <div class="cue__body"><span class="cue__cat">${m.label} · ${SEVERITY[a.severity].label}</span>
            <p class="cue__note">${a.note}</p></div>
          <span class="cue__sev">${dots}</span>
        </div>`;
    }).join("");
    return `
      <section class="cuelist">
        <div class="cuelist__head"><h3>Every notice, in order</h3><div class="filters">${filters}</div></div>
        <div class="cues" id="cues">${rows}</div>
      </section>`;
  }

  function noTimestampsHTML(t, nud) {
    return `
      <section class="notimes">
        <div class="notimes__icon">${nud ? "◐" : "🎞️"}</div>
        <h3>No verified timestamps in our log${t.curated ? "" : " yet"}</h3>
        <p>TMDB gives a reliable <strong>${nud ? "nudity-present" : "nudity status"}</strong> signal, but
        <strong>no public API exposes frame-accurate timecodes</strong>. For scene-level timing,
        the crowd-sourced links below are the place to look.</p>
      </section>`;
  }

  function sourcesHTML(t) {
    const titleYear = t.title + (t.year ? ` ${t.year}` : "");
    const g = (extra) => `https://www.google.com/search?q=${encodeURIComponent(titleYear + " " + extra)}`;
    const imdb = t.imdb_id
      ? `https://www.imdb.com/title/${t.imdb_id}/parentalguide`
      : `https://www.imdb.com/find/?q=${encodeURIComponent(t.title)}&s=tt`;
    const links = [
      ["IMDb Parents Guide", imdb, "severity levels (no timecodes)"],
      ["Reddit", `https://www.reddit.com/search/?q=${encodeURIComponent(t.title + " nudity scene")}`, "community threads"],
      ["Unconsented", g("nudity timestamps site:unconsented.com"), "crowd scene timecodes"],
      ["Does the Dog Die?", g("site:doesthedogdie.com"), "content flags"],
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
    if (title.tmdbRecs && title.tmdbRecs.length) {
      items = title.tmdbRecs.map((r) => ({
        key: "tmdb-" + r.type + "-" + r.id, tmdbId: r.id, type: r.type,
        title: r.title, year: r.year, cert: r.cert, poster: r.poster,
        overlap: r.overlap, shared: (r.genres || []).filter((g) => title.genres.includes(g)),
      }));
    } else {
      items = localRecommend(title).map(({ t, overlap, shared }) => ({
        key: t.id, localId: t.id, type: t.type, title: t.title, year: t.year,
        cert: t.cert, poster: null, _t: t, overlap, shared,
      }));
    }
    if (!items.length) return "";
    const head = nud
      ? `<div class="recs__head"><h3>Clean picks, same genre</h3><span class="recs__badge">NO NUDITY ✓</span></div>
         <p class="recs__sub">Because <strong>${title.title}</strong> contains nudity, here are titles sharing its genres with none detected.</p>`
      : `<div class="recs__head"><h3>More like this</h3><span class="recs__badge">NO NUDITY ✓</span></div>
         <p class="recs__sub">Same-genre titles also clear of nudity.</p>`;
    const cards = items.map((r) => `
      <button class="rec" data-key="${r.key}" ${r.tmdbId ? `data-tmdb-id="${r.tmdbId}" data-tmdb-type="${r.type}"` : ""} ${r.localId ? `data-local-id="${r.localId}"` : ""}>
        <div class="rec__poster" style="${posterStyle(r)}">${posterInner(r)}<span class="rec__clean">NO NUDITY</span></div>
        <div class="rec__body">
          <span class="rec__title">${r.title}</span>
          <span class="rec__meta">${[r.year, r.cert, r.type === "tv" ? "TV" : "Film"].filter(Boolean).join(" · ")}</span>
          ${r.shared && r.shared.length ? `<span class="rec__match">↳ shares <b>${r.overlap}</b> genre${r.overlap > 1 ? "s" : ""}: ${r.shared.join(", ")}</span>` : `<span class="rec__match">↳ same-genre pick</span>`}
        </div>
      </button>`).join("");
    return `<section class="recs">${head}<div class="recgrid">${cards}</div></section>`;
  }

  function notFoundHTML(query) {
    const sugg = DATA.slice(0, 6).map((t) => `<button class="chip" data-id="${t.id}">${t.title}</button>`).join("");
    const note = LIVE
      ? `TMDB has no movie or TV match for “${query}”. Check the spelling, or try one of these:`
      : `Live search isn't configured, so CUEPOINT is running on its curated set — “${query}” isn't in it. Try one of these:`;
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
          genresLabel: t.genres.slice(0, 2).join(", "), poster: null, _localRef: t,
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
        renderSuggest(res.map((r) => ({
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
          <div class="libcard__poster" style="${posterStyle(t)}"><span class="pinitial">${initials(t)}</span><span class="pshine"></span>
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

  /* --------------------------- live-mode badge --------------------------- */
  function showModeBadge() {
    const nav = $(".topbar__nav"); if (!nav) return;
    const b = document.createElement("span");
    b.className = "modebadge " + (LIVE ? "is-live" : "is-demo");
    b.innerHTML = LIVE
      ? `<i></i>Live · TMDB`
      : `<i></i>Demo · curated`;
    b.title = LIVE ? "Connected to TMDB — search any title" : "No TMDB key set — searching the curated library only";
    nav.insertBefore(b, nav.firstChild);
  }

  /* -------------------------------- init --------------------------------- */
  async function init() {
    $("#year").textContent = new Date().getFullYear();
    runIntro(); buildRibbon(); buildChips(); buildLibrary(); wireReveals();
    // wire search immediately (works in demo mode) so the input is never dead
    wireSearch();
    // then detect live mode and upgrade the UI; handlers read LIVE at event time
    await detectLive();
    showModeBadge();
    const input = $("#searchInput");
    if (input) input.placeholder = LIVE
      ? "Search any movie or show — “Oppenheimer”, “The Bear”, “Saltburn”…"
      : "Try “Titanic”, “Stranger Things”, “Parasite”…";
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
