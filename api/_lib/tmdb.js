/* Shared TMDB helper for CUEPOINT serverless functions.
   Underscore-prefixed folder => not treated as a route by Vercel, only imported.

   Configure ONE of these in the Vercel project env:
     TMDB_API_KEY  — a v3 API key (32-char), OR
     TMDB_TOKEN    — a v4 Read Access Token (long JWT, sent as Bearer)
*/

const V3_KEY = process.env.TMDB_API_KEY || "";
const V4_TOKEN = process.env.TMDB_TOKEN || "";
const BASE = "https://api.themoviedb.org/3";

export const LIVE = !!(V3_KEY || V4_TOKEN);
export const IMG = (path, size = "w500") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export async function tmdb(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { accept: "application/json" };
  if (V4_TOKEN) headers.Authorization = `Bearer ${V4_TOKEN}`;
  else url.searchParams.set("api_key", V3_KEY);

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

/* keyword-based nudity signal — the only reliable structured nudity data
   TMDB exposes. It tells us WHETHER nudity is present, never WHEN. */
const NUDITY_RE =
  /\b(nudity|nude|topless|full frontal|frontal nudity|sex scene|sex|erotic|nipple|breasts?|strip club|stripper|orgy|threesome|softcore|seduction)\b/i;

export function nudityFromKeywords(keywords = []) {
  const hits = keywords
    .map((k) => k.name)
    .filter((n) => NUDITY_RE.test(n));
  return { nudity: hits.length > 0, keywords: [...new Set(hits)] };
}

export function keywordsOf(detail, type) {
  const k = detail.keywords || {};
  return (type === "movie" ? k.keywords : k.results) || [];
}

export function certOf(detail, type) {
  if (type === "movie") {
    const us = (detail.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
    const c = (us?.release_dates || []).map((x) => x.certification).find(Boolean);
    return c || "NR";
  }
  const us = (detail.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US");
  return us?.rating || "NR";
}
