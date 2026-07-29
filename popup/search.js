import { initTheme } from "../lib/theme.js";
import { createDevLogger, captureGlobalErrors } from "../lib/devlog.js";
import { TRANSPARENT_PX, faviconUrlFor } from "../lib/favicon.js";
import { querySearch, resolveWindowId } from "../lib/searchclient.js";

const dev = createDevLogger("popup");
captureGlobalErrors(dev);

const focusState = () => JSON.stringify({
  hasFocus: document.hasFocus(),
  active: document.activeElement?.id || document.activeElement?.tagName || "",
});
dev.log("popup start", "loadMs=", Math.round(performance.now()), "focus=", focusState());
for (const at of [50, 150, 400]) setTimeout(() => dev.log("popup focus@", at, focusState()), at);
window.addEventListener("focus", () => dev.log("window focus", focusState()));
window.addEventListener("blur", () => dev.log("window blur", focusState()));
window.addEventListener("keydown", (e) => dev.log("popup key", e.key, focusState()), { once: true });

initTheme();

const input = document.getElementById("q");
const resultsEl = document.getElementById("results");
const sidebarBtn = document.getElementById("open-sidebar");

let windowId = null;
const windowReady = resolveWindowId(null).then((id) => { windowId = id; return id; });
let seq = 0;
let debounce = null;
let selIdx = -1;
let current = [];

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

async function run(query) {
  const mySeq = ++seq;
  const t0 = performance.now();
  let done = false;
  await windowReady;
  if (query) {
    querySearch({ windowId, query, semantic: false })
      .then((tabs) => { if (mySeq === seq && !done) render(tabs); })
      .catch((e) => dev.log("lexical search failed", String(e?.message || e)));
  }
  try {
    const tabs = await querySearch({ windowId, query, semantic: true });
    done = true;
    dev.log("search done seq=", mySeq, "ms=", Math.round(performance.now() - t0));
    if (mySeq === seq) render(tabs);
  } catch (e) {
    done = true;
    dev.log("search ERROR seq=", mySeq, "err=", String(e?.message || e));
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
  if (!q) { seq++; run(""); return; }
  debounce = setTimeout(() => run(q), 110);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); }
  else if (e.key === "Enter") { e.preventDefault(); if (selIdx >= 0) activate(current[selIdx]); }
  else if (e.key === "Escape") { e.preventDefault(); window.close(); }
});
input.addEventListener("focus", () => dev.log("input focus", focusState()));
input.addEventListener("blur", () => dev.log("input blur", focusState()));

sidebarBtn.addEventListener("click", () => {
  browser.sidebarAction.open().catch((e) => dev.log("sidebar open failed", String(e?.message || e)));
  window.close();
});

window.addEventListener("focus", () => input.focus());
document.addEventListener("keydown", (e) => {
  if (document.activeElement === input || document.activeElement === sidebarBtn) return;
  if (e.key === "Tab") return;
  input.focus();
}, true);

windowReady
  .then(async () => {
    input.focus();
    dev.log("popup ready", "ms=", Math.round(performance.now()), "focus=", focusState(), "typedAhead=", JSON.stringify(input.value));
    await run(input.value.trim());
  })
  .catch((e) => {
    dev.log("popup load FAILED", String(e?.message || e));
    console.error("[arctictab] popup load failed", e);
    resultsEl.innerHTML = '<li class="empty">Failed to load tabs</li>';
  });
