/* downly — motor cliente.
   Todo el trabajo pesado lo hacen instancias públicas de cobalt;
   la página solo orquesta: turnstile -> jwt -> post / -> url de descarga. */

const INSTANCES = [
  "bergung-api.hoffnungfuerdiezukunft.net",
  "apicobalt.girlskissing.top",
  "nuko-c.meowing.de",
  "yuuri-c.meowing.de",
  "eulogy-c.meowing.de",
  "api.cobalt.rpkiinval.id",
  "grapefruit.clxxped.lol",
  "lime.clxxped.lol",
  "melon.clxxped.lol",
  "cobaltapi.kittycat.boo",
  "dog.kittycat.boo",
  "capi.3kh0.net",
  "cobalt-api.meowing.de",
  "cobalt-backend.canine.tools",
];

const $ = (id) => document.getElementById(id);
const sessions = {};   // host -> { jwt, expMs }
let turnstileApi = null;
let busy = false;

/* estado de selección */
const state = { mode: "auto", vquality: "max", abitrate: "128" };

/* ---------- detección de servicio ---------- */

const SERVICES = [
  [/youtube\.com|youtu\.be|music\.youtube/i, "YouTube"],
  [/open\.spotify\.com|spotify\.link/i, "Spotify"],
  [/tiktok\.com/i, "TikTok"],
  [/instagram\.com/i, "Instagram"],
  [/twitter\.com|x\.com/i, "X / Twitter"],
  [/twitch\.tv/i, "Twitch"],
  [/soundcloud\.com/i, "SoundCloud"],
  [/reddit\.com/i, "Reddit"],
  [/vimeo\.com/i, "Vimeo"],
  [/facebook\.com|fb\.watch/i, "Facebook"],
  [/pinterest\./i, "Pinterest"],
  [/bilibili\./i, "Bilibili"],
  [/dailymotion\./i, "Dailymotion"],
  [/snapchat\./i, "Snapchat"],
  [/bsky\.app|bluesky/i, "Bluesky"],
  [/tumblr\./i, "Tumblr"],
  [/streamable\./i, "Streamable"],
  [/ok\.ru|odnoklassniki/i, "OK.ru"],
  [/vk\.com|vkvideo/i, "VK"],
  [/loom\.com/i, "Loom"],
];

function detectService(url) {
  const det = $("detected");
  if (!url) { det.classList.add("hidden"); return; }
  const hit = SERVICES.find(([re]) => re.test(url));
  det.classList.remove("hidden");
  det.textContent = hit ? `detectado: ${hit[1]}` : "servicio no reconocido — probaré igualmente";
  det.style.color = hit ? "" : "var(--err)";
}

/* ---------- UI helpers ---------- */

function showStatus() { $("status").classList.remove("hidden"); $("status").innerHTML = ""; }
function step(text) {
  const div = document.createElement("div");
  div.className = "step";
  div.innerHTML = '<span class="spin"></span><span></span>';
  div.querySelector("span:last-child").textContent = text;
  $("status").appendChild(div);
  return div;
}
function setStep(el, text, state) {
  el.className = "step " + state;
  el.textContent = text;
}
function clearResult() { $("result").classList.add("hidden"); $("picker").classList.add("hidden"); }

function showResult(url, filename) {
  const r = $("result");
  r.classList.remove("hidden");
  r.innerHTML = "";
  const f = document.createElement("div");
  f.className = "fname";
  f.textContent = filename || "descarga lista";
  const a = document.createElement("a");
  a.className = "dl";
  a.href = url;
  a.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg> guardar archivo';
  a.setAttribute("download", filename || "");
  a.target = "_blank";
  a.rel = "noopener";
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = "si no empieza solo, mantén pulsado el botón → «guardar enlace»";
  r.append(f, a, note);
  a.click();
}

function showPicker(items) {
  const p = $("picker");
  p.classList.remove("hidden");
  p.innerHTML = "<h3>varios elementos en el enlace — elige cuál bajar:</h3>";
  items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "item";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = i + 1;
    const t = document.createElement("span");
    t.textContent = it.type === "photo" ? "imagen" : "vídeo / audio";
    const a = document.createElement("a");
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "descargar ↗";
    row.append(n, t, a);
    p.appendChild(row);
  });
}

/* ---------- historial ---------- */

function pushHistory(url, filename) {
  try {
    const h = JSON.parse(localStorage.getItem("dl_history") || "[]");
    h.unshift({ url, filename, t: Date.now() });
    localStorage.setItem("dl_history", JSON.stringify(h.slice(0, 15)));
    renderHistory();
  } catch (e) {}
}
function renderHistory() {
  const h = JSON.parse(localStorage.getItem("dl_history") || "[]");
  const sec = $("historysec"), ul = $("history");
  if (!h.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  ul.innerHTML = "";
  h.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x.filename || x.url;
    ul.appendChild(li);
  });
}

/* ---------- turnstile ---------- */

function loadTurnstile() {
  if (turnstileApi) return Promise.resolve(turnstileApi);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => { turnstileApi = window.turnstile; res(turnstileApi); };
    s.onerror = () => rej(new Error("no se pudo cargar turnstile"));
    document.head.appendChild(s);
  });
}

function solveTurnstile(sitekey) {
  return loadTurnstile().then((ts) => new Promise((res, rej) => {
    const slot = $("ts");
    slot.innerHTML = "";
    const timer = setTimeout(() => rej(new Error("turnstile tardó demasiado")), 30000);
    try {
      ts.render(slot, {
        sitekey,
        callback: (token) => { clearTimeout(timer); res(token); },
        "error-callback": () => { clearTimeout(timer); rej(new Error("turnstile falló")); },
        size: "compact",
      });
    } catch (e) { clearTimeout(timer); rej(e); }
  }));
}

/* ---------- cobalt ---------- */

async function getInfo(host) {
  const r = await fetch(`https://${host}/`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("info http " + r.status);
  const j = await r.json();
  if (!j.cobalt) throw new Error("respuesta rara");
  return j.cobalt;
}

async function getJwt(host, info) {
  const s = sessions[host];
  if (s && s.expMs - Date.now() > 20000) return s.jwt;
  if (!info.turnstileSitekey) return null;              // instancia sin turnstile
  const token = await solveTurnstile(info.turnstileSitekey);
  const r = await fetch(`https://${host}/session`, {
    method: "POST",
    headers: { Accept: "application/json", "cf-turnstile-response": token },
  });
  const j = await r.json();
  if (!j.token) throw new Error("session: " + (j.error?.code || r.status));
  sessions[host] = { jwt: j.token, expMs: Date.now() + j.exp * 1000 };
  return j.token;
}

async function cobaltRequest(host, jwt, body) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (jwt) headers.Authorization = "Bearer " + jwt;
  const r = await fetch(`https://${host}/`, { method: "POST", headers, body: JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok && !j.status) j = { status: "error", error: { code: "http_" + r.status } };
  return j;
}

/* intenta la descarga contra cada instancia hasta que una funcione */
async function cobaltDownload(payload, log) {
  const errs = [];
  for (const host of INSTANCES) {
    let st;
    try {
      st = log(`conectando con ${host.split(".")[0]}…`);
      const info = await getInfo(host);
      const jwt = await getJwt(host, info);
      setStep(st, `instancia ${host.split(".")[0]} ok`, "done");

      st = log("pidiendo el archivo…");
      const resp = await cobaltRequest(host, jwt, payload);
      if (resp.status === "tunnel" || resp.status === "redirect") {
        setStep(st, "enlace listo", "done");
        return { ok: true, url: resp.url, filename: resp.filename, host };
      }
      if (resp.status === "picker") {
        setStep(st, "varios elementos", "done");
        return { ok: true, picker: resp.picker || [], host };
      }
      const code = resp.error?.code || "desconocido";
      setStep(st, `dijo: ${code}`, "err");
      errs.push(`${host}: ${code}`);
      if (code.includes("jwt") || code.includes("auth")) delete sessions[host];
    } catch (e) {
      if (st) setStep(st, `fallo: ${e.message}`, "err");
      errs.push(`${host}: ${e.message}`);
    }
  }
  return { ok: false, errs };
}

/* ---------- spotify ---------- */

async function resolveSpotify(url) {
  const r = await fetch(`/api/resolve-spotify?url=${encodeURIComponent(url)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "no se pudo resolver el enlace de spotify");
  return j.tracks; // [{title, query, youtubeUrl}]
}

/* ---------- orquestación ---------- */

async function run() {
  if (busy) return;
  const url = $("url").value.trim();
  if (!url) { $("url").focus(); return; }

  busy = true;
  $("go").disabled = true;
  clearResult();
  showStatus();

  try {
    const isSpotify = /open\.spotify\.com|spotify\.link/.test(url);
    const base = {
      downloadMode: state.mode,
      videoQuality: state.vquality,
      audioFormat: "mp3",
      audioBitrate: state.abitrate,
      filenameStyle: "basic",
      disableMetadata: false,
    };

    if (isSpotify) {
      const st = step("resolviendo canción(es) de spotify…");
      const tracks = await resolveSpotify(url);
      setStep(st, `${tracks.length} canción(es) encontrada(s)`, "done");
      let done = 0;
      for (const t of tracks) {
        const s2 = step(`bajando: ${t.title}…`);
        const res = await cobaltDownload({ ...base, url: t.youtubeUrl, downloadMode: "audio" }, step);
        if (res.ok && res.url) {
          setStep(s2, `lista: ${t.title}`, "done");
          showResult(res.url, res.filename || (t.title + ".mp3"));
          pushHistory(url, res.filename || t.title);
        } else {
          setStep(s2, `falló: ${t.title}`, "err");
        }
        if (++done >= 10) { step("límite de 10 pistas por tanda", "err"); break; }
      }
      return;
    }

    const res = await cobaltDownload({ ...base, url }, step);
    if (res.ok && res.url) {
      showResult(res.url, res.filename);
      pushHistory(url, res.filename);
    } else if (res.ok && res.picker) {
      showPicker(res.picker);
      pushHistory(url, "varios elementos");
    } else {
      step("ninguna instancia pudo con este enlace ahora mismo — prueba en un rato u otro link", "err");
      console.warn(res.errs);
    }
  } catch (e) {
    step("error: " + e.message, "err");
  } finally {
    busy = false;
    $("go").disabled = false;
  }
}

/* ---------- wiring ---------- */

$("go").addEventListener("click", run);
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
$("url").addEventListener("input", (e) => detectService(e.target.value.trim()));
$("url").addEventListener("paste", () => setTimeout(() => detectService($("url").value.trim()), 0));
$("paste").addEventListener("click", async () => {
  try {
    $("url").value = await navigator.clipboard.readText();
    detectService($("url").value.trim());
    $("url").focus();
  } catch (e) { $("url").focus(); }
});

/* segmented: modo */
document.querySelectorAll("#segmode .segbtn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#segmode .segbtn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.mode = b.dataset.mode;
    const audio = state.mode === "audio";
    $("quals-audio").classList.toggle("hidden", !audio);
    $("quals-video").classList.toggle("hidden", audio);
  });
});

/* píldoras: calidad */
document.querySelectorAll("#quals-video .qbtn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#quals-video .qbtn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.vquality = b.dataset.q;
  });
});
document.querySelectorAll("#quals-audio .qbtn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#quals-audio .qbtn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.abitrate = b.dataset.q;
  });
});

renderHistory();
