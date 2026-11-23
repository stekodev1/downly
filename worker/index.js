// downly-dl — túnel de descarga en Cloudflare Workers.
// A diferencia de Vercel (límite de duración real), aquí el límite es de
// CPU (10ms) — un stream lento puede durar lo que haga falta.
// GET /?u=<url del stream>&f=<nombre de archivo>

const ALLOWED = [
  "gendownload.com",
  "tikwm.com",
  "tikwm.io",
  "twimg.com",
  "tiktokcdn.com",
];

export default {
  async fetch(request) {
    const params = new URL(request.url).searchParams;
    const u = params.get("u") || "";
    const fname = (params.get("f") || "downly").slice(0, 150);

    let target;
    try {
      target = new URL(u);
    } catch {
      return new Response("url inválida", { status: 400 });
    }
    const ok =
      target.protocol === "https:" &&
      ALLOWED.some((d) => target.hostname === d || target.hostname.endsWith("." + d));
    if (!ok) return new Response("host no permitido", { status: 403 });

    const up = await fetch(target, { redirect: "follow" });
    if (!up.ok || !up.body) {
      return new Response("el origen respondió " + up.status, { status: 502 });
    }

    const safe = fname.replace(/[\\\/:*?"<>|\r\n]/g, "_").replace(/"/g, "_");
    const h = new Headers();
    h.set(
      "Content-Disposition",
      `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`
    );
    h.set("Content-Type", up.headers.get("content-type") || "application/octet-stream");
    const len = up.headers.get("content-length");
    if (len) h.set("Content-Length", len);
    h.set("Cache-Control", "no-store");
    h.set("Access-Control-Allow-Origin", "*");

    return new Response(up.body, { status: 200, headers: h });
  },
};
