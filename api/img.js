/* GET /api/img?u=<tmdb image url>
   Same-origin proxy for TMDB poster images so the share-card <canvas> stays
   un-tainted (TMDB doesn't send CORS headers). Restricted to image.tmdb.org. */
export default async function handler(req, res) {
  const u = (req.query.u || "").toString();
  if (!/^https:\/\/image\.tmdb\.org\/[\w/.\-]+$/.test(u)) {
    res.status(400).json({ error: "bad url" });
    return;
  }
  try {
    const r = await fetch(u);
    if (!r.ok) { res.status(502).end(); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).end();
  }
}
