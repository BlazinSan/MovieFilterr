/* DoesTheDogDie integration — a crowd-voted nudity signal.
   Far better recall than TMDB keyword tags: DTDD has explicit topics like
   "Are there nude scenes" / "Is there sexual content" with yes/no vote counts,
   so we can confirm nudity present AND confirm absence. (Scene timecodes exist
   on DTDD but are paywalled on the free API tier, so timestamps still come from
   our curated log.) DTDD search results include `tmdbid`, enabling exact match. */

const clean = (s) => (s || "").replace(/[^\x21-\x7E]/g, "");
const KEY = clean(process.env.DTDD_API_KEY);
export const DTDD_LIVE = !!KEY;

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

async function ddd(path) {
  const r = await fetch("https://www.doesthedogdie.com" + path, {
    headers: { "X-API-KEY": KEY, Accept: "application/json" },
  });
  if (!r.ok) throw new Error("DTDD " + r.status);
  return r.json();
}

/* Returns { nudity: true|false|null, source:"dtdd", url, dtddId, votes, labels }
   or null when DTDD is unconfigured or has no usable data for this title. */
export async function dtddNudity(tmdbId, title, year) {
  if (!KEY) return null;
  try {
    const s = await ddd("/dddsearch?q=" + encodeURIComponent(title));
    const items = s.items || [];
    const item =
      (tmdbId != null && items.find((i) => String(i.tmdbid) === String(tmdbId))) ||
      items.find((i) => norm(i.name) === norm(title) && (!year || String(i.releaseYear) === String(year))) ||
      items.find((i) => norm(i.name) === norm(title)) ||
      null;
    if (!item) return null;

    const m = await ddd("/media/" + item.id);
    const stats = m.topicItemStats || [];
    const find = (re) => {
      const t = stats.find((x) => re.test(x.topic?.name || "") || re.test(x.topic?.doesName || ""));
      return t ? { yes: +t.yesSum || 0, no: +t.noSum || 0 } : null;
    };
    const nude = find(/nude scenes|\bnudity\b/i);
    const sex = find(/sexual content/i);
    const url = "https://www.doesthedogdie.com/media/" + item.id;

    const labels = [];
    let nudity = null;
    let votes = null;

    if (nude && nude.yes > nude.no && nude.yes >= 2) {
      nudity = true; votes = nude; labels.push(`nude scenes (${nude.yes}✓/${nude.no}✗)`);
    } else if (sex && sex.yes > sex.no && sex.yes >= 3) {
      nudity = true; votes = sex; labels.push(`sexual content (${sex.yes}✓/${sex.no}✗)`);
    } else if (nude && nude.yes + nude.no >= 5 && nude.no >= nude.yes) {
      nudity = false; votes = nude;
    }
    if (nudity === true && sex && sex.yes > sex.no && !labels.some((l) => l.startsWith("sexual"))) {
      labels.push(`sexual content (${sex.yes}✓/${sex.no}✗)`);
    }
    return { nudity, source: "dtdd", url, dtddId: item.id, votes, labels };
  } catch {
    return null;
  }
}
