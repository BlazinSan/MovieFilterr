/* ============================================================================
   CUEPOINT — app logic
   ========================================================================== */
(function () {
  "use strict";

  const { DATA, CATEGORIES, SEVERITY } = window.CUEPOINT;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------- utilities ------------------------------- */

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    const ss = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
  }

  function hasNudity(title) {
    return title.advisories.some((a) => a.category === "nudity");
  }

  // deterministic gradient from a string → unique "poster" per title
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function posterStyle(title) {
    const h = hashHue(title.id);
    const h2 = (h + 48) % 360;
    return `background:
      radial-gradient(120% 90% at 20% 0%, hsl(${h} 70% 22%), transparent 60%),
      linear-gradient(150deg, hsl(${h} 65% 30%), hsl(${h2} 60% 18%));`;
  }
  function initials(title) {
    const words = title.title.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase() || "??";
  }

  // fuzzy score: higher is better, 0 = no match
  function score(query, title) {
    const q = query.toLowerCase().trim();
    if (!q) return 0;
    const t = title.title.toLowerCase();
    if (t === q) return 1000;
    if (t.startsWith(q)) return 800 - t.length;
    if (t.includes(q)) return 600 - t.indexOf(q);
    // word-boundary initials, e.g. "got" → Game Of Thrones
    const initialsStr = t.split(/\s+/).map((w) => w[0]).join("");
    if (initialsStr.startsWith(q)) return 500;
    // subsequence fuzzy
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
    if (qi === q.length) return 200 - (t.length - q.length);
    // token overlap
    const qt = q.split(/\s+/);
    const hit = qt.filter((w) => w.length > 1 && t.includes(w)).length;
    return hit > 0 ? 100 + hit * 20 : 0;
  }

  function searchTitles(query, limit = 6) {
    return DATA.map((t) => ({ t, s: score(query, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.t);
  }

  function bestMatch(query) {
    const r = searchTitles(query, 1);
    return r[0] || null;
  }

  /* --------------------------- recommendations --------------------------- */
  // same-genre titles with NO nudity, ranked by genre overlap then mildness
  function recommend(title, limit = 6) {
    const gset = new Set(title.genres);
    return DATA
      .filter((t) => t.id !== title.id && !hasNudity(t))
      .map((t) => {
        const overlap = t.genres.filter((g) => gset.has(g));
        return { t, overlap: overlap.length, shared: overlap };
      })
      .filter((x) => x.overlap > 0)
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        // prefer milder overall content as tiebreak
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
    // allow skip
    window.addEventListener("keydown", done, { once: true });
    intro.addEventListener("click", done, { once: true });
  }

  /* ------------------------- hero ribbon (decor) ------------------------- */
  function buildRibbon() {
    const track = $("#ribbonTrack");
    if (!track) return;
    const colors = Object.values(CATEGORIES).map((c) => c.color);
    let html = "";
    const make = () => {
      let s = "";
      for (let i = 0; i < 120; i++) {
        const c = colors[Math.floor(Math.random() * colors.length)];
        const h = 12 + Math.random() * 40;
        s += `<span class="ribbon__tick" style="height:${h}px;background:${c}"></span>`;
      }
      return s;
    };
    track.innerHTML = make() + make(); // duplicated for seamless loop
  }

  /* ------------------------------ rendering ------------------------------ */
  const result = $("#result");

  function render(title) {
    const nud = hasNudity(title);
    const sorted = [...title.advisories].sort((a, b) => a.t - b.t);

    // counts per category
    const byCat = {};
    for (const a of sorted) {
      (byCat[a.category] ||= []).push(a);
    }
    const usedCats = Object.keys(CATEGORIES).filter((c) => byCat[c]);

    result.innerHTML = `
      <article class="rcard">
        ${headerHTML(title)}
        ${verdictHTML(title, nud)}
        ${summaryHTML(byCat, usedCats, sorted.length)}
        ${timelineHTML(title, sorted, usedCats)}
        ${cueListHTML(sorted, usedCats)}
        ${recsHTML(title, nud)}
      </article>`;

    result.hidden = false;
    wireTimeline(title, sorted);
    wireFilters();
    wireRecClicks();
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    countUp();
  }

  function headerHTML(t) {
    return `
      <header class="rhead">
        <div class="rhead__poster" style="${posterStyle(t)}">
          <span class="pinitial">${initials(t)}</span><span class="pshine"></span>
        </div>
        <div class="rhead__main">
          <div class="rhead__kicker">
            <span class="tag tag--cert">${t.cert}</span>
            <span class="tag tag--type">${t.type === "tv" ? "TV Series" : "Film"}</span>
            <span class="tag">${t.year}</span>
            <span class="tag">${fmtTime(t.runtime)}${t.type === "tv" ? " / ep" : ""}</span>
          </div>
          <h2 class="rhead__title">${t.title}</h2>
          <p class="rhead__tagline">“${t.tagline}”</p>
          <div class="rhead__genres">${t.genres.map((g) => `<span class="genre">${g}</span>`).join("")}</div>
        </div>
      </header>`;
  }

  function verdictHTML(t, nud) {
    if (nud) {
      const n = t.advisories.filter((a) => a.category === "nudity").length;
      return `
        <div class="verdict verdict--flag">
          <span class="verdict__dot"></span>
          <p class="verdict__text"><strong>Contains nudity / sexual content</strong> —
          <b>${n} notice${n > 1 ? "s" : ""}</b> flagged. Scroll for timecodes, plus
          <strong>clean same-genre picks</strong> with none below.</p>
        </div>`;
    }
    return `
      <div class="verdict verdict--clear">
        <span class="verdict__dot"></span>
        <p class="verdict__text"><strong>No nudity detected</strong> in our log for this title.
        Other advisories are timestamped below.</p>
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
          <div class="catcard__top">
            <span class="catcard__glyph">${meta.glyph}</span>
            <span class="catcard__label">${meta.label}</span>
          </div>
          <div class="catcard__count" data-count="${items.length}">0</div>
          <div class="catcard__sev">${dots}</div>
        </div>`;
    }).join("");
    return `
      <section class="summary">
        <div class="summary__head">
          <h3>Advisory summary</h3>
          <span class="summary__total mono">${total} timestamped notices · ${usedCats.length} categories</span>
        </div>
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
      const markers = sorted
        .filter((a) => a.category === c)
        .map((a) => {
          const pct = (a.t / t.runtime) * 100;
          const delay = reduce ? 0 : (a.t / t.runtime) * 0.5 + 0.1;
          return `<button class="marker" data-sev="${a.severity}" data-t="${a.t}"
                    style="left:${pct}%;--cat:${m.color};--d:${delay.toFixed(2)}s"
                    aria-label="${m.label} at ${fmtTime(a.t)}: ${a.note}"></button>`;
        }).join("");
      return `
        <div class="lane" style="--cat:${m.color}">
          <span class="lane__name">${m.label.split(" ")[0]}</span>
          <div class="lane__track"></div>
          ${markers}
        </div>`;
    }).join("");

    return `
      <section class="timeline">
        <div class="timeline__head">
          <h3>Scene timeline</h3>
          <div class="timeline__legend">${legend}</div>
        </div>
        <div class="scrubwrap">
          <div class="timecode-readout mono">▶ <b id="tcNow">0:00</b> / ${fmtTime(t.runtime)}
            <span id="tcNear" style="color:var(--ink-dim)"></span></div>
          <div class="lanes" id="lanes">
            ${lanes}
            <div class="playhead" id="playhead">
              <div class="playhead__line"></div>
              <div class="playhead__grip" id="grip" role="slider" tabindex="0"
                   aria-label="Scrub timeline" aria-valuemin="0" aria-valuemax="${t.runtime}" aria-valuenow="0"></div>
            </div>
          </div>
          <div class="axis">
            <span>0:00</span><span>${fmtTime(t.runtime/4)}</span><span>${fmtTime(t.runtime/2)}</span>
            <span>${fmtTime(t.runtime*3/4)}</span><span>${fmtTime(t.runtime)}</span>
          </div>
          <div class="tip" id="tip"></div>
        </div>
      </section>`;
  }

  function cueListHTML(sorted, usedCats) {
    const filters = `<button class="filter is-active" data-cat="all">All</button>` +
      usedCats.map((c) => {
        const m = CATEGORIES[c];
        return `<button class="filter" data-cat="${c}" style="--cat:${m.color}"><i></i>${m.label}</button>`;
      }).join("");

    const rows = sorted.map((a) => {
      const m = CATEGORIES[a.category];
      const dots = [1, 2, 3].map((n) => `<span class="cue__sevdot ${n <= a.severity ? "on" : ""}"></span>`).join("");
      return `
        <div class="cue" data-cat="${a.category}" data-t="${a.t}" style="--cat:${m.color}">
          <span class="cue__time mono">${fmtTime(a.t)}</span>
          <span class="cue__icon">${m.glyph}</span>
          <div class="cue__body">
            <span class="cue__cat">${m.label} · ${SEVERITY[a.severity].label}</span>
            <p class="cue__note">${a.note}</p>
          </div>
          <span class="cue__sev">${dots}</span>
        </div>`;
    }).join("");

    return `
      <section class="cuelist">
        <div class="cuelist__head">
          <h3>Every notice, in order</h3>
          <div class="filters">${filters}</div>
        </div>
        <div class="cues" id="cues">${rows}</div>
      </section>`;
  }

  function recsHTML(title, nud) {
    const recs = recommend(title);
    if (!recs.length) return "";
    const head = nud
      ? `<div class="recs__head"><h3>Clean picks, same genre</h3><span class="recs__badge">NO NUDITY ✓</span></div>
         <p class="recs__sub">Because <strong>${title.title}</strong> contains nudity, here are
         titles sharing its genres with none in our log.</p>`
      : `<div class="recs__head"><h3>More like this</h3><span class="recs__badge">NO NUDITY ✓</span></div>
         <p class="recs__sub">Same-genre titles that are also clear of nudity.</p>`;

    const cards = recs.map(({ t, overlap, shared }) => `
      <button class="rec" data-id="${t.id}">
        <div class="rec__poster" style="${posterStyle(t)}">
          <span class="pinitial">${initials(t)}</span><span class="pshine"></span>
          <span class="rec__clean">NO NUDITY</span>
        </div>
        <div class="rec__body">
          <span class="rec__title">${t.title}</span>
          <span class="rec__meta">${t.year} · ${t.cert} · ${t.type === "tv" ? "TV" : "Film"}</span>
          <span class="rec__match">↳ shares <b>${overlap}</b> genre${overlap > 1 ? "s" : ""}: ${shared.join(", ")}</span>
        </div>
      </button>`).join("");

    return `<section class="recs">${head}<div class="recgrid">${cards}</div></section>`;
  }

  function notFoundHTML(query) {
    const sugg = DATA.slice(0, 6).map((t) =>
      `<button class="chip" data-id="${t.id}">${t.title}</button>`).join("");
    return `
      <article class="rcard">
        <div class="empty">
          <div class="empty__glyph">🎞️</div>
          <h3>No verified scene log for “${query}”</h3>
          <p>CUEPOINT runs on a curated, hand-timed reference set — “${query}” isn't in it yet.
             No public API exposes timestamped advisories, so we only show titles we can stand behind.
             Try one of these:</p>
          <div class="empty__sugg">${sugg}</div>
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

      // highlight nearby markers (within 4% of runtime)
      let nearest = null, nd = Infinity;
      markers.forEach((mk) => {
        const mt = +mk.dataset.t;
        const d = Math.abs(mt - sec);
        const isNear = d < title.runtime * 0.03;
        mk.classList.toggle("is-near", isNear);
        if (d < nd) { nd = d; nearest = mk; }
      });
      if (nearest && nd < title.runtime * 0.05) {
        const a = sorted.find((x) => x.t === +nearest.dataset.t);
        tcNear.textContent = `· near: ${a.note.slice(0, 46)}${a.note.length > 46 ? "…" : ""}`;
      } else {
        tcNear.textContent = "";
      }
    }

    // drag
    let dragging = false;
    function pointerToPct(clientX) {
      const r = trackRect();
      return ((clientX - r.left) / r.width) * 100;
    }
    function onMove(e) {
      if (!dragging) return;
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setPlayhead(pointerToPct(x));
    }
    function startDrag(e) { dragging = true; document.body.style.userSelect = "none"; onMove(e); }
    function endDrag() { dragging = false; document.body.style.userSelect = ""; }

    grip.addEventListener("mousedown", startDrag);
    grip.addEventListener("touchstart", startDrag, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);

    // click anywhere on lanes to seek
    lanes.addEventListener("click", (e) => {
      if (e.target.classList.contains("marker")) return;
      const r = trackRect();
      if (e.clientX < r.left) return;
      setPlayhead(pointerToPct(e.clientX));
    });

    // keyboard on grip
    grip.addEventListener("keydown", (e) => {
      const cur = +grip.getAttribute("aria-valuenow");
      const step = title.runtime * 0.02;
      let next = cur;
      if (e.key === "ArrowRight") next = cur + step;
      else if (e.key === "ArrowLeft") next = cur - step;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = title.runtime;
      else return;
      e.preventDefault();
      setPlayhead((next / title.runtime) * 100);
    });

    // marker hover/focus → tooltip + jump
    function showTip(mk) {
      const a = sorted.find((x) => x.t === +mk.dataset.t);
      if (!a) return;
      const meta = CATEGORIES[a.category];
      const lanesRect = lanes.getBoundingClientRect();
      const mkRect = mk.getBoundingClientRect();
      tip.style.setProperty("--cat", meta.color);
      tip.innerHTML =
        `<span class="tip__time mono">${fmtTime(a.t)}</span><span class="tip__cat" style="color:${meta.color}">${meta.label}</span>
         <p class="tip__note">${a.note}</p>`;
      tip.style.left = (mkRect.left - lanesRect.left + mkRect.width / 2) + "px";
      tip.style.top = (mkRect.top - lanesRect.top) + "px";
      tip.classList.add("is-on");
    }
    function hideTip() { tip.classList.remove("is-on"); }

    markers.forEach((mk) => {
      mk.addEventListener("mouseenter", () => showTip(mk));
      mk.addEventListener("mouseleave", hideTip);
      mk.addEventListener("focus", () => showTip(mk));
      mk.addEventListener("blur", hideTip);
      mk.addEventListener("click", () => {
        setPlayhead((+mk.dataset.t / title.runtime) * 100);
      });
    });

    setPlayhead(0);
  }

  /* ----------------------------- cue filters ----------------------------- */
  function wireFilters() {
    const filterBtns = $$(".filter");
    const cues = $$(".cue");
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        const cat = btn.dataset.cat;
        cues.forEach((c) => {
          c.classList.toggle("is-hidden", cat !== "all" && c.dataset.cat !== cat);
        });
      });
    });
  }

  function wireRecClicks() {
    $$(".rec", result).forEach((card) => {
      card.addEventListener("click", () => {
        const t = DATA.find((x) => x.id === card.dataset.id);
        if (t) { $("#searchInput").value = t.title; render(t); }
      });
    });
    $$(".empty__sugg .chip", result).forEach((chip) => {
      chip.addEventListener("click", () => {
        const t = DATA.find((x) => x.id === chip.dataset.id);
        if (t) { $("#searchInput").value = t.title; render(t); }
      });
    });
  }

  /* --------------------------- count-up numbers -------------------------- */
  function countUp() {
    if (reduce) {
      $$(".catcard__count").forEach((el) => (el.textContent = el.dataset.count));
      return;
    }
    $$(".catcard__count").forEach((el) => {
      const target = +el.dataset.count;
      let n = 0;
      const step = Math.max(1, Math.ceil(target / 14));
      const tick = () => {
        n = Math.min(target, n + step);
        el.textContent = n;
        if (n < target) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------- search UI ----------------------------- */
  function wireSearch() {
    const form = $("#searchForm");
    const input = $("#searchInput");
    const suggest = $("#suggest");
    let activeIdx = -1;

    function renderSuggest(items) {
      if (!items.length) {
        suggest.innerHTML = `<li class="suggest__empty">No match in library — press Enter to see suggestions.</li>`;
        suggest.classList.add("is-open");
        input.setAttribute("aria-expanded", "true");
        return;
      }
      suggest.innerHTML = items.map((t, i) => {
        const nud = hasNudity(t);
        return `
          <li class="suggest__item ${i === activeIdx ? "is-active" : ""}" role="option" data-id="${t.id}">
            <span class="suggest__poster" style="${posterStyle(t)}"></span>
            <span class="suggest__meta">
              <span class="suggest__title">${t.title}</span>
              <span class="suggest__sub">${t.year} · ${t.genres.slice(0,2).join(", ")}</span>
            </span>
            <span class="suggest__flag" style="color:${nud ? "var(--c-nudity)" : "var(--c-substances)"}">
              ${nud ? "◐ nudity" : "✓ clean"}
            </span>
          </li>`;
      }).join("");
      suggest.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      $$(".suggest__item", suggest).forEach((li) => {
        li.addEventListener("click", () => choose(DATA.find((x) => x.id === li.dataset.id)));
      });
    }

    function closeSuggest() {
      suggest.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      activeIdx = -1;
    }

    function choose(title) {
      if (!title) return;
      input.value = title.title;
      closeSuggest();
      render(title);
    }

    let items = [];
    function onInput() {
      const q = input.value.trim();
      activeIdx = -1;
      if (!q) { closeSuggest(); return; }
      items = searchTitles(q);
      renderSuggest(items);
    }

    input.addEventListener("input", onInput);
    input.addEventListener("focus", () => { if (input.value.trim()) onInput(); });

    input.addEventListener("keydown", (e) => {
      if (!suggest.classList.contains("is-open")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); renderSuggest(items); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); renderSuggest(items); }
      else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); choose(items[activeIdx]); }
      else if (e.key === "Escape") closeSuggest();
    });

    document.addEventListener("click", (e) => {
      if (!form.contains(e.target)) closeSuggest();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      closeSuggest();
      const match = bestMatch(q);
      if (match) render(match);
      else { result.innerHTML = notFoundHTML(q); result.hidden = false; wireRecClicks();
             result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
    });

    // "/" focuses search
    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== input) {
        e.preventDefault(); input.focus(); input.select();
      }
    });
    $("#focusSearch")?.addEventListener("click", () => { input.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }

  /* ------------------------------ quick chips ---------------------------- */
  function buildChips() {
    const wrap = $("#quickChips");
    if (!wrap) return;
    const picks = ["Titanic", "The Dark Knight", "Game of Thrones", "Parasite", "Coco", "The Boys"];
    wrap.innerHTML = picks.map((p) => `<button class="chip" data-q="${p}">${p}</button>`).join("");
    $$(".chip", wrap).forEach((c) => {
      c.addEventListener("click", () => {
        $("#searchInput").value = c.dataset.q;
        const m = bestMatch(c.dataset.q);
        if (m) render(m);
      });
    });
  }

  /* ------------------------------- library ------------------------------- */
  function buildLibrary() {
    const grid = $("#libraryGrid");
    if (!grid) return;
    grid.innerHTML = DATA.map((t) => {
      const nud = hasNudity(t);
      const sevBars = [...new Set(t.advisories.map((a) => a.category))]
        .map((c) => `<span class="dotsev" style="--cat:${CATEGORIES[c].color}"></span>`).join("");
      return `
        <button class="libcard" data-id="${t.id}">
          <div class="libcard__poster" style="${posterStyle(t)}">
            <span class="pinitial">${initials(t)}</span><span class="pshine"></span>
            <span class="libcard__flag">${sevBars}</span>
          </div>
          <div class="libcard__body">
            <span class="libcard__title">${t.title}</span>
            <span class="libcard__meta">${t.year} · ${t.cert} · ${t.type === "tv" ? "TV" : "Film"}</span>
            <span class="libcard__nud ${nud ? "nud-yes" : "nud-no"}"><i></i>${nud ? "Contains nudity" : "No nudity"}</span>
          </div>
        </button>`;
    }).join("");

    $$(".libcard", grid).forEach((card) => {
      card.addEventListener("click", () => {
        const t = DATA.find((x) => x.id === card.dataset.id);
        if (t) { $("#searchInput").value = t.title; render(t); }
      });
    });
  }

  /* ------------------------- scroll reveal + topbar ---------------------- */
  function wireReveals() {
    const topbar = $("#topbar");
    window.addEventListener("scroll", () => {
      topbar.classList.toggle("is-stuck", window.scrollY > 10);
    }, { passive: true });

    if (reduce || !("IntersectionObserver" in window)) {
      $$(".how__card, .libcard").forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          const el = e.target;
          const sibs = Array.from(el.parentElement.children);
          el.style.transitionDelay = (sibs.indexOf(el) % 8) * 60 + "ms";
          el.classList.add("in");
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12 });
    $$(".how__card, .libcard").forEach((el) => io.observe(el));
  }

  /* -------------------------------- init --------------------------------- */
  function init() {
    $("#year").textContent = new Date().getFullYear();
    runIntro();
    buildRibbon();
    buildChips();
    buildLibrary();
    wireSearch();
    wireReveals();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
