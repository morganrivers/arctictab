import { buildText, embedBatch, getExtractor } from "../lib/embed.js";
import { getMany } from "../lib/cache.js";
import { buildBm25, rankTabs } from "../lib/search.js";
import { initTheme } from "../lib/theme.js";
import { createFileLogger } from "../lib/devlog.js";
import { TRANSPARENT_PX, faviconUrlFor } from "../lib/favicon.js";

const dev = createFileLogger("popup", { flushMs: 60_000 });
dev.log("popup start", location.search);
window.addEventListener("pagehide", () => { dev.flush(); });
let inflightEmbeds = 0;

initTheme();

const params = new URLSearchParams(location.search);
const srcWindowId = params.has("win") ? Number(params.get("win")) : null;

const input = document.getElementById("q");
const resultsEl = document.getElementById("results");

let docs = [];
let bm25 = null;
let seq = 0;
let debounce = null;
let selIdx = -1;
let current = [];

async function loadDocs() {
  const query = srcWindowId != null ? { windowId: srcWindowId } : { currentWindow: true };
  const tabs = await browser.tabs.query(query);
  const texts = tabs.map((t) => buildText(t, null));
  const cached = await getMany(tabs.map((t) => t.url));
  docs = tabs.map((t, i) => ({
    tab: t,
    text: texts[i],
    embedding: cached[i]?.embedding || null,
  }));
  bm25 = buildBm25(texts);
  dev.log("loadDocs tabs=", tabs.length, "embedHits=", cached.filter((c) => c?.embedding).length);
}

function showAll() {
  render(docs.map((d) => d.tab));
}

function render(items) {
  current = items;
  selIdx = items.length ? 0 : -1;
  resultsEl.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = input.value.trim() ? "No matching tabs" : "Type to search open tabs";
    resultsEl.appendChild(li);
    return;
  }
  items.forEach((tab, i) => {
    const li = document.createElement("li");
    li.className = "result" + (i === selIdx ? " selected" : "");
    li.setAttribute("role", "option");
    const fav = document.createElement("img");
    fav.className = "favicon";
    fav.alt = "";
    fav.referrerPolicy = "no-referrer";
    fav.addEventListener("error", () => { fav.src = TRANSPARENT_PX; });
    fav.src = faviconUrlFor(tab);
    const title = document.createElement("span");
    title.className = "r-title";
    title.textContent = tab.title || tab.url;
    const host = document.createElement("span");
    host.className = "r-host";
    try { host.textContent = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
    li.appendChild(fav);
    li.appendChild(title);
    li.appendChild(host);
    li.addEventListener("click", () => activate(tab));
    resultsEl.appendChild(li);
  });
}

function computeAndRender(query, queryEmbedding, allowEmpty = true) {
  if (!bm25) return;
  const ranked = rankTabs({
    bm25Index: bm25,
    embeddings: docs.map((d) => d.embedding),
    query,
    queryEmbedding,
    limit: 20,
  });
  if (!ranked.length && !allowEmpty) return;
  render(ranked.map((r) => docs[r.index].tab));
}

async function run(q) {
  const mySeq = ++seq;
  if (q.length < 2) { computeAndRender(q, null); return; }
  let embedded = false;
  const fallback = setTimeout(() => {
    if (!embedded && mySeq === seq) computeAndRender(q, null, false);
  }, 120);
  const t0 = performance.now();
  inflightEmbeds++;
  dev.log("run q.len=", q.length, "seq=", mySeq, "inflight=", inflightEmbeds);
  try {
    await getExtractor();
    const tExt = performance.now();
    const [emb] = await embedBatch([q]);
    embedded = true;
    inflightEmbeds--;
    dev.log("run done seq=", mySeq, "extractorMs=", Math.round(tExt - t0), "embedMs=", Math.round(performance.now() - tExt), "inflight=", inflightEmbeds);
    clearTimeout(fallback);
    if (mySeq === seq) computeAndRender(q, emb);
  } catch (e) {
    embedded = true;
    inflightEmbeds--;
    dev.log("run ERROR seq=", mySeq, "ms=", Math.round(performance.now() - t0), "inflight=", inflightEmbeds, "err=", String(e?.message || e));
    clearTimeout(fallback);
    console.warn("[arctictab] popup embed failed", e);
    if (mySeq === seq) computeAndRender(q, null);
  }
}

function moveSelection(delta) {
  if (!current.length) return;
  selIdx = (selIdx + delta + current.length) % current.length;
  const nodes = resultsEl.querySelectorAll(".result");
  nodes.forEach((n, i) => n.classList.toggle("selected", i === selIdx));
  nodes[selIdx]?.scrollIntoView({ block: "nearest" });
}

async function activate(tab) {
  try {
    await browser.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    console.warn("[arctictab] popup activate failed", e);
  }
  window.close();
}

input.addEventListener("input", () => {
  const q = input.value.trim();
  clearTimeout(debounce);
  if (!q) { seq++; showAll(); return; }
  debounce = setTimeout(() => run(q), 110);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
  else if (e.key === "Enter") { e.preventDefault(); if (selIdx >= 0) activate(current[selIdx]); }
  else if (e.key === "Escape") { e.preventDefault(); window.close(); }
});
let blurArmed = false;
setTimeout(() => { blurArmed = true; }, 500);
window.addEventListener("blur", () => {
  if (!blurArmed) return;
  setTimeout(() => { if (!document.hasFocus()) { dev.log("popup close on sustained blur"); window.close(); } }, 250);
});

loadDocs()
  .then(() => { showAll(); input.focus(); })
  .catch((e) => {
    dev.log("loadDocs FAILED", String(e?.message || e));
    console.error("[arctictab] popup load failed", e);
    resultsEl.innerHTML = '<li class="empty">Failed to load tabs</li>';
  });

const tWarm = performance.now();
dev.log("warm getExtractor start");
getExtractor()
  .then(() => dev.log("warm getExtractor ready ms=", Math.round(performance.now() - tWarm)))
  .catch((e) => dev.log("warm getExtractor FAILED ms=", Math.round(performance.now() - tWarm), String(e?.message || e)));
