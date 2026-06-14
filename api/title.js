import { tmdb, LIVE, IMG, nudityFromKeywords, keywordsOf, certOf } from "./_lib/tmdb.js";
import { dtddNudity } from "./_lib/dtdd.js";

/* GET /api/title?type=movie|tv&id=123
   Returns title detail + nudity signal + same-genre clean recommendations. */
export default async function handler(req, res) {
  if (!LIVE) return res.status(200).json({ live: false });

  const type = req.query.type === "tv" ? "tv" : "movie";
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const appends =
      type === "movie"
        ? "keywords,release_dates,recommendations,similar,external_ids"
        : "keywords,content_ratings,recommendations,similar,external_ids";

    const d = await tmdb(`/${type}/${id}`, { append_to_response: appends });

    const nud = nudityFromKeywords(keywordsOf(d, type));
    const genres = (d.genres || []).map((g) => g.name);
    const gset = new Set(genres);
    const runtime =
      type === "movie" ? (d.runtime || 0) * 60 : (d.episode_run_time?.[0] || 0) * 60;

    // pool recommendations + similar, dedupe, cap for latency
    const pool = [...(d.recommendations?.results || []), ...(d.similar?.results || [])]
      .filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i)
      .slice(0, 12);

    const year = (d.release_date || d.first_air_date || "").slice(0, 4);

    // fetch candidate keywords (for clean recs) and the DTDD nudity signal,
    // all in parallel
    const [candidates, dtdd] = await Promise.all([
      Promise.all(
        pool.map(async (r) => {
          try {
            const rd = await tmdb(`/${type}/${r.id}`, { append_to_response: "keywords" });
            const rn = nudityFromKeywords(keywordsOf(rd, type));
            const rg = (rd.genres || []).map((g) => g.name);
            return {
              id: r.id,
              type,
              title: rd.title || rd.name,
              year: (rd.release_date || rd.first_air_date || "").slice(0, 4),
              cert: certOf(rd, type),
              poster: IMG(rd.poster_path, "w342"),
              genres: rg,
              nudity: rn.nudity,
              overlap: rg.filter((g) => gset.has(g)).length,
            };
          } catch {
            return null;
          }
        })
      ),
      dtddNudity(d.id, d.title || d.name, year),
    ]);

    const recommendations = candidates
      .filter(Boolean)
      .filter((r) => !r.nudity && r.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 8);

    // Combine nudity signals: DTDD crowd votes (reliable true OR false) take
    // precedence; otherwise the sparse TMDB keyword tag (true | null).
    let nudity, nuditySource, nudityKeywords, nudityVotes = null, dtddUrl = null, dtddId = null;
    if (dtdd) { dtddUrl = dtdd.url; dtddId = dtdd.dtddId; }
    if (dtdd && dtdd.nudity !== null) {
      nudity = dtdd.nudity;
      nuditySource = "dtdd";
      nudityVotes = dtdd.votes;
      nudityKeywords = dtdd.labels.length ? dtdd.labels : nud.keywords;
    } else {
      nudity = nud.nudity ? true : null;
      nuditySource = nud.nudity ? "tmdb" : null;
      nudityKeywords = nud.keywords;
    }

    res.setHeader("Cache-Control", "public, max-age=600");
    res.status(200).json({
      live: true,
      title: {
        id: d.id,
        type,
        title: d.title || d.name,
        year,
        cert: certOf(d, type),
        runtime,
        genres,
        tagline: d.tagline || (d.overview ? d.overview.slice(0, 140) : ""),
        poster: IMG(d.poster_path, "w500"),
        backdrop: IMG(d.backdrop_path, "w780"),
        imdb_id: d.external_ids?.imdb_id || null,
        // nudity: true (confirmed) | false (DTDD crowd confirms absence) | null
        // (no reliable signal -> UI says "unconfirmed", never a false negative)
        nudity,
        nuditySource,        // "dtdd" | "tmdb" | null
        nudityKeywords,
        nudityVotes,         // { yes, no } from DTDD when source is dtdd
        dtddUrl,
        dtddId,
        // categorised, crowd-voted advisories (no timecodes) — always-available
        advisories: dtdd?.advisories || [],
      },
      recommendations,
    });
  } catch (e) {
    res.status(200).json({ live: false, error: String(e) });
  }
}
