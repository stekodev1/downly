// Vercel serverless function: resuelve enlaces de Spotify a vídeos de YouTube.
// GET /api/resolve-spotify?url=<spotify url>
// Devuelve { tracks: [{ title, query, youtubeUrl }] }

const PIPED = [
  "https://api.piped.private.coffee",
  "https://pipedapi.ducks.party",
  "https://pipedapi.adminforge.de",
  "https://api.piped.yt",
];

function parseSpotify(url) {
  const m = url.match(/spotify\.com\/(intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  return { type: m[2], id: m[3] };
}

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json();
  return j.access_token || null;
}

async function oembedTitle(url) {
  const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error("oembed spotify " + r.status);
  const j = await r.json();
  // title suele ser "Canción", author_name el artista
  return { title: j.title || "", artist: j.author_name || "" };
}

async function tracksViaApi(parsed, token) {
  const h = { Authorization: "Bearer " + token };
  const out = [];
  if (parsed.type === "track") {
    const r = await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}`, { headers: h });
    const j = await r.json();
    if (j.name) out.push(`${j.artists?.[0]?.name || ""} - ${j.name}`.trim());
  } else if (parsed.type === "album") {
    const r = await fetch(`https://api.spotify.com/v1/albums/${parsed.id}/tracks?limit=10`, { headers: h });
    const j = await r.json();
    (j.items || []).forEach((t) => out.push(`${t.artists?.[0]?.name || ""} - ${t.name}`.trim()));
  } else if (parsed.type === "playlist") {
    const r = await fetch(
      `https://api.spotify.com/v1/playlists/${parsed.id}/tracks?limit=10&fields=items(track(name,artists(name)))`,
      { headers: h }
    );
    const j = await r.json();
    (j.items || []).forEach((it) => {
      const t = it.track;
      if (t?.name) out.push(`${t.artists?.[0]?.name || ""} - ${t.name}`.trim());
    });
  }
  return out;
}

async function youtubeMatch(query) {
  for (const base of PIPED) {
    try {
      const r = await fetch(
        `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`,
        { headers: { Accept: "application/json" } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const item = (j.items || []).find((i) => i.url && i.url.includes("watch?v="));
      if (item) return "https://www.youtube.com" + item.url;
      const anyVid = (j.items || []).find((i) => i.url && /watch\?v=/.test(i.url));
      if (anyVid) return "https://www.youtube.com" + anyVid.url;
    } catch (e) { /* siguiente instancia */ }
  }
  // segunda pasada con filtro genérico
  for (const base of PIPED) {
    try {
      const r = await fetch(
        `${base}/search?q=${encodeURIComponent(query)}&filter=videos`,
        { headers: { Accept: "application/json" } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const item = (j.items || []).find((i) => i.url && i.url.includes("watch?v="));
      if (item) return "https://www.youtube.com" + item.url;
    } catch (e) {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = req.query.url || "";
  const parsed = parseSpotify(url);
  if (!parsed) return res.status(400).json({ error: "enlace de spotify no válido" });

  try {
    let queries = [];
    const token = await spotifyToken().catch(() => null);

    if (token) {
      queries = await tracksViaApi(parsed, token);
    } else if (parsed.type === "track") {
      const o = await oembedTitle(url);
      queries = [`${o.artist} - ${o.title}`.trim()];
    } else {
      return res.status(400).json({
        error: "para playlists/álbumes hace falta SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en las env vars de vercel",
      });
    }

    if (!queries.length) return res.status(404).json({ error: "no se encontraron canciones" });

    const tracks = [];
    for (const q of queries.slice(0, 10)) {
      const yt = await youtubeMatch(q);
      if (yt) tracks.push({ title: q, query: q, youtubeUrl: yt });
    }
    if (!tracks.length) return res.status(404).json({ error: "no encontré la canción en youtube" });
    res.json({ tracks });
  } catch (e) {
    res.status(500).json({ error: "error interno" });
  }
};
