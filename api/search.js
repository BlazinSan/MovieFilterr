import { tmdb, LIVE, IMG } from "./_lib/tmdb.js";

/* GET /api/search?q=...  -> simplified multi-search (movies + tv) */
export default async function handler(req, res) {
  if (!LIVE) return res.status(200).json({ live: false, results: [] });

  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(200).json({ live: true, results: [] });

  try {
    const data = await tmdb("/search/multi", {
      query: q,
      include_adult: true,
      page: 1,
    });
    const results = (data.results || [])
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        type: r.media_type,
        title: r.title || r.name,
        year: (r.release_date || r.first_air_date || "").slice(0, 4),
        poster: IMG(r.poster_path, "w185"),
        overview: r.overview || "",
      }));
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).json({ live: true, results });
  } catch (e) {
    res.status(200).json({ live: false, error: String(e), results: [] });
  }
}
