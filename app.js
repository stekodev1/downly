/* downly — motor cliente.
   Resuelve enlaces contra APIs públicas de extracción (gendownload
   y respaldo); la página solo orquesta: extract -> elegir formato -> descarga. */

const ENGINES = [
  {
    name: "gendownload",
    extract: (url) => fetch("https://gendownload.com/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).then((r) => r.json()),
  },
  {
    name: "tikwm",
    match: /tiktok\.com/,
    extract: (url) => fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j) => ({
        title: j?.data?.title,
        source: "tiktok",
        formats: j?.data ? [
          j.data.play && { label: "HD", type: "video", ext: "mp4", url: j.data.play },
          j.data.music && { label: "Audio", type: "audio", ext: "mp3", url: j.data.music },
        ].filter(Boolean) : [],
      })),
  },
  {
    name: "fxtwitter",
    match: /twitter\.com|x\.com/,
    extract: (url) => fetch(`https://api.fxtwitter.com/${url.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//, "")}`)
      .then((r) => r.json())
      .then((j) => ({
        title: j?.tweet?.text,
        source: "x",
        formats: (j?.tweet?.media?.videos || []).map((v) => ({ label: "Vídeo", type: "video", ext: "mp4", url: v.url })),
      })),
  },
];

const $ = (id) => document.getElementById(id);
let busy = false;

/* nombres de archivo con marca */
const brandName = (t, ext) =>
  `${(t || "downly").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80)} - getdownly.vercel.app.${ext}`;

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
  det.textContent = hit ? `Detectado: ${hit[1]}` : "Servicio no reconocido — probaré igualmente";
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
function clearResult() { $("result").classList.add("hidden"); }

function showResult(url, filename, altUrl) {
  if (!/^(https:\/\/|blob:|\/api\/)/.test(url)) return; // solo urls seguras
  const r = $("result");
  r.classList.remove("hidden");
  r.innerHTML = '<div class="rcheck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>';
  const f = document.createElement("div");
  f.className = "fname";
  f.textContent = filename || "Descarga lista";
  const a = document.createElement("a");
  a.className = "dl";
  a.href = url;
  a.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg> Guardar archivo';
  a.setAttribute("download", filename || "");
  const note = document.createElement("div");
  note.className = "note";
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  note.textContent = isIOS
    ? "En iPhone: mantén pulsado «Guardar archivo» → Descargar vídeo / Guardar en Archivos"
    : "Si no empieza solo, pulsa «Guardar archivo» — o usa el enlace alternativo";
  r.append(f, a, note);
  if (altUrl && /^(https:\/\/|\/api\/)/.test(altUrl)) {
    const alt = document.createElement("a");
    alt.className = "alt";
    alt.href = altUrl;
    alt.setAttribute("download", filename || "");
    alt.textContent = "descarga alternativa ↗";
    r.appendChild(alt);
  }
}

/* ---------- historial (solo en memoria — no se guarda nada) ---------- */

const historyItems = [];
function pushHistory(url, filename) {
  historyItems.unshift({ url, filename, t: Date.now() });
  historyItems.length = Math.min(historyItems.length, 15);
  renderHistory();
}
function renderHistory() {
  const sec = $("historysec"), ul = $("history");
  if (!historyItems.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  ul.innerHTML = "";
  historyItems.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x.filename || x.url;
    ul.appendChild(li);
  });
}

/* ---------- motores de extracción ---------- */

async function extract(url, log) {
  const errs = [];
  for (const eng of ENGINES) {
    if (eng.match && !eng.match.test(url)) continue;
    const st = log("Resolviendo el enlace…");
    try {
      const data = await eng.extract(url);
      if (!data || !Array.isArray(data.formats) || !data.formats.length) {
        const msg = data?.message || "sin formatos";
        setStep(st, `Dijo: ${msg}`, "err");
        errs.push(`${eng.name}: ${msg}`);
        continue;
      }
      setStep(st, "Enlace listo", "done");
      return { ok: true, data, engine: eng.name };
    } catch (e) {
      setStep(st, `Fallo: ${e.message}`, "err");
      errs.push(`${eng.name}: ${e.message}`);
    }
  }
  return { ok: false, errs };
}

/* estrategia de descarga:
   - gendownload (upstream ~25KB/s capado): enlace directo — su servidor
     envía attachment nativo, el navegador lo gestiona sin límite de
     tiempo y con reanudación. el proxy se queda como alternativa.
   - tikwm / twimg (CDN rápidos): siempre proxy — marca + attachment. */
function dlRoute(pick, fname) {
  const proxy = `/api/dl?u=${encodeURIComponent(pick.url)}&f=${encodeURIComponent(fname)}`;
  let host = "";
  try { host = new URL(pick.url).hostname; } catch {}
  const slowUp = /(^|\.)gendownload\.com$/i.test(host);
  return slowUp
    ? { main: pick.url, alt: proxy }
    : { main: proxy, alt: pick.url };
}

async function deliver(pick, fname) {
  const s3 = step("Descargando archivo…");
  const { main, alt } = dlRoute(pick, fname);
  const a = document.createElement("a");
  a.href = main;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStep(s3, "Descarga completada", "done");
  showResult(main, fname, alt);
}

/* elige el mejor formato según el modo y la calidad elegida */
function pickFormat(formats, { mode, vquality }) {
  const vids = formats.filter((f) => f.type === "video" && f.url);
  const auds = formats.filter((f) => f.type === "audio" && f.url);
  const q = (f) => parseInt(f.label, 10) || 0;

  if (mode === "audio") return auds[0] || null;
  if (!vids.length) return auds[0] || null;   // solo hay audio disponible

  if (vquality === "max") return vids.reduce((a, b) => (q(b) > q(a) ? b : a));
  const target = parseInt(vquality, 10);
  const le = vids.filter((f) => q(f) <= target).sort((a, b) => q(b) - q(a))[0];
  return le || vids.reduce((a, b) => (q(b) < q(a) ? b : a)); // si no hay ≤, la más baja
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
  $("go").classList.add("loading");
  const goLabel = $("go").querySelector("span");
  const goLabelOld = goLabel.textContent;
  goLabel.textContent = "Descargando…";
  clearResult();
  showStatus();

  try {
    const isSpotify = /open\.spotify\.com|spotify\.link/.test(url);

    if (isSpotify) {
      const st = step("Resolviendo canción(es) de spotify…");
      const tracks = await resolveSpotify(url);
      setStep(st, `${tracks.length} canción(es) encontrada(s)`, "done");
      let done = 0;
      for (const t of tracks) {
        const s2 = step(`Bajando: ${t.title}…`);
        const res = await extract(t.youtubeUrl, step);
        const pick = res.ok ? pickFormat(res.data.formats, { mode: "audio" }) : null;
        if (pick) {
          setStep(s2, `Lista: ${t.title}`, "done");
          const fn = brandName(t.title, pick.ext || "mp3");
          await deliver(pick, fn);
          pushHistory(url, fn);
        } else {
          setStep(s2, `Falló: ${t.title}`, "err");
        }
        if (++done >= 10) { step("Límite de 10 pistas por tanda", "err"); break; }
      }
      return;
    }

    const res = await extract(url, step);
    if (!res.ok) {
      step("No pude con este enlace ahora mismo — prueba en un rato u otro link", "err");
      console.warn(res.errs);
      return;
    }
    const pick = pickFormat(res.data.formats, state);
    if (!pick) {
      step("No encontré un formato compatible para este enlace", "err");
      return;
    }
    const fname = brandName(res.data.title, pick.ext || (pick.type === "audio" ? "mp3" : "mp4"));
    await deliver(pick, fname);
    pushHistory(url, fname);
  } catch (e) {
    step("Error: " + e.message, "err");
  } finally {
    busy = false;
    $("go").disabled = false;
    $("go").classList.remove("loading");
    goLabel.textContent = goLabelOld;
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

/* efectos de puntero — solo con ratón real (ahorro en táctil) */
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

if (finePointer) {
  /* spotlight que sigue al cursor en tarjetas */
  document.querySelectorAll(".tool, .feat").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  /* botón magnético */
  const goBtn = $("go");
  goBtn.addEventListener("pointermove", (e) => {
    const r = goBtn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    goBtn.style.transform = `translate(${dx * 0.16}px, ${dy * 0.26}px)`;
  });
  goBtn.addEventListener("pointerleave", () => { goBtn.style.transform = ""; });

  /* parallax sutil del fondo */
  const bgEl = document.querySelector(".bg");
  addEventListener("pointermove", (e) => {
    const x = (e.clientX / innerWidth - 0.5) * 26;
    const y = (e.clientY / innerHeight - 0.5) * 20;
    bgEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, { passive: true });
}

/* placeholder rotativo */
const PH = ["Pega un link de YouTube…", "Pega un link de Spotify…", "Pega un link de TikTok…",
            "Pega un link de Instagram…", "Pega un link de X…", "Pega un link de Twitch…",
            "Pega aquí tu enlace…"];
let phi = 0;
setInterval(() => {
  const inp = $("url");
  if (document.activeElement === inp || inp.value) return;
  inp.classList.add("phswap");
  setTimeout(() => {
    phi = (phi + 1) % PH.length;
    inp.placeholder = PH[phi];
    inp.classList.remove("phswap");
  }, 420);
}, 3400);

/* features: reveal al hacer scroll */
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: 0.2 });
document.querySelectorAll(".feat").forEach((f, i) => {
  f.classList.add("pre");
  f.style.transitionDelay = `${i * 70}ms`;
  io.observe(f);
});

renderHistory();
