// Vercel serverless function: túnel de descarga con Content-Disposition propio.
// GET /api/dl?u=<url del stream>&f=<nombre de archivo>
// El navegador solo habla con este dominio: CORS propio, nombre de archivo
// garantizado y la página nunca navega a un host externo.

const { Readable } = require("stream");

// allowlist anti-SSRF: solo los hosts que devuelven nuestros motores
const ALLOWED = [
  "gendownload.com",
  "tikwm.com",
  "tikwm.io",
  "twimg.com",
  "tiktokcdn.com",
];

function allowedHost(h) {
  return ALLOWED.some((d) => h === d || h.endsWith("." + d));
}

module.exports = async function handler(req, res) {
  const u = (req.query.u || "").toString();
  const fname = (req.query.f || "downly").toString().slice(0, 150);

  let url;
  try {
    url = new URL(u);
  } catch {
    return res.status(400).json({ error: "url inválida" });
  }
  if (url.protocol !== "https:" || !allowedHost(url.hostname)) {
    return res.status(403).json({ error: "host no permitido" });
  }

  let up;
  try {
    up = await fetch(url.toString(), { redirect: "follow" });
  } catch {
    return res.status(502).json({ error: "no se pudo contactar con el origen" });
  }
  if (!up.ok || !up.body) {
    return res.status(502).json({ error: "el origen respondió " + up.status });
  }

  const safe = fname.replace(/[\\\/:*?"<>|\r\n]/g, "_");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safe.replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`
  );
  res.setHeader("Content-Type", up.headers.get("content-type") || "application/octet-stream");
  const len = up.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);
  res.setHeader("Cache-Control", "no-store");

  Readable.fromWeb(up.body).pipe(res);
};
