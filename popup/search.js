import { buildText, embedBatch, getExtractor } from "../lib/embed.js";
import { getMany } from "../lib/cache.js";
import { buildBm25, rankTabs } from "../lib/search.js";
import { initTheme } from "../lib/theme.js";

initTheme();

const params = new URLSearchParams(location.search);
const srcWindowId = params.has("win") ? Number(params.get("win")) : null;

const input = document.getElementById("q");
const resultsEl = document.getElementById("results");

const TRANSPARENT_PX =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2014%2014%22%3E%3Crect%20width%3D%2214%22%20height%3D%2214%22%20rx%3D%223%22%20fill%3D%22%23999%22%20opacity%3D%220.25%22%2F%3E%3C%2Fsvg%3E";

function faviconUrlFor(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome:")) return tab.favIconUrl;
  return fallbackFaviconUrl(tab);
}
function fallbackFaviconUrl(tab) {
  try {
    const u = new URL(tab.url);
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.origin}/favicon.ico`;
  } catch {}
  return TRANSPARENT_PX;
}

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
    fav.addEventListener("error", () => {
      const fb = fallbackFaviconUrl(tab);
      fav.src = fb !== fav.src ? fb : TRANSPARENT_PX;
    });
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
  try {
    await getExtractor();
    const [emb] = await embedBatch([q]);
    embedded = true;
    clearTimeout(fallback);
    if (mySeq === seq) computeAndRender(q, emb);
  } catch (e) {
    embedded = true;
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
window.addEventListener("blur", () => window.close());

loadDocs()
  .then(() => { showAll(); input.focus(); })
  .catch((e) => {
    console.error("[arctictab] popup load failed", e);
    resultsEl.innerHTML = '<li class="empty">Failed to load tabs</li>';
  });
getExtractor().catch(() => {});
