import { LIVE } from "./_lib/tmdb.js";

/* GET /api/config -> tells the client whether live TMDB search is configured. */
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json({ live: LIVE });
}
