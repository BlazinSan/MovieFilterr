/* DoesTheDogDie integration — crowd-voted parental-guidance signal.
   DTDD exposes ~200 yes/no content topics per title (with vote counts), so we
   can (a) confirm nudity present AND absent, and (b) build a categorised
   advisory list for virtually any title — making results always available.
   (Scene timecodes exist on DTDD but are paywalled on the free API tier, so
   exact timestamps still come from our curated log.) Search results carry
   `tmdbid`, enabling an exact TMDB match. */

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

// map a DTDD topic phrase to one of our six categories (first match wins)
const CAT_RULES = [
  ["nudity", /(nud|sex|breast|topless|genital|incest|porn|strip club|stripper|erotic|make ?out|making out|masturbat|lingerie)/i],
  ["substances", /(drug|alcohol|smok|drunk|overdose|addict|cocaine|heroin|gets high|getting high|hypodermic|needle|vaping|marijuana|weed)/i],
  ["profanity", /(slur|n-word|f-word|f-slur|profanity|swear|cuss|racial slur)/i],
  ["violence", /(blood|gore|gun|shot|shoot|kill|murder|stab|fight|torture|beaten|punch|\bwar\b|violence|massacre|slaughter|impale|decapitat|mutilat|abuse|whip|strangl)/i],
  ["frightening", /(jump ?scare|flashing light|claustrophob|anxiety|panic attack|disturbing|body horror|spider|snake|vomit|gaslight|stalk|restrained|struggles to breathe|nightmare|possess|demon|grotesque|drown|falls to (his|her|their) death)/i],
  ["other", /(dies|death|\bdead\b|suicide|self ?harm|cutting|shaving\/cutting|grief|miscarriage|terminal|cancer|kidnap|sexual assault|\brape\b|child.*(die|harm)|parent dies|cheat|divorce|sad ending|racism|homophob|abandon)/i],
];

function categorize(name) {
  for (const [cat, re] of CAT_RULES) if (re.test(name)) return cat;
  return null;
}

// turn the full topic-vote list into a ranked, categorised advisory list
function buildAdvisories(stats) {
  const seen = new Set();
  const out = [];
  for (const s of stats) {
    const yes = +s.yesSum || 0, no = +s.noSum || 0;
    if (yes <= no || yes < 4) continue; // needs community consensus it's present
    const name = s.topic?.name || "";
    const cat = categorize(name);
    if (!cat) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const ratio = yes / (yes + no);
    const severity = yes >= 45 && ratio >= 0.8 ? 3 : yes >= 12 && ratio >= 0.6 ? 2 : 1;
    const note = name.charAt(0).toUpperCase() + name.slice(1);
    out.push({ category: cat, severity, note, votes: { yes, no } });
  }
  const order = { nudity: 0, violence: 1, substances: 2, frightening: 3, profanity: 4, other: 5 };
  out.sort((a, b) => (order[a.category] - order[b.category]) || (b.severity - a.severity) || (b.votes.yes - a.votes.yes));
  return out.slice(0, 16);
}

/* Returns { nudity, source, url, dtddId, votes, labels, advisories } or null. */
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

    return { nudity, source: "dtdd", url, dtddId: item.id, votes, labels, advisories: buildAdvisories(stats) };
  } catch {
    return null;
  }
}
