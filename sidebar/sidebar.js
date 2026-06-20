import { buildText, embedBatch, getExtractor, onExtractorProgress } from "../lib/embed.js";
import { getMany, put } from "../lib/cache.js";
import { detectExcursionsTargeted, WINDOW_STOPS } from "../lib/cluster.js";
import { nameGroups } from "../lib/names.js";

const $ = (s) => document.querySelector(s);
const status = (m) => console.log("[arctictab][status]", m);

const slider = $("#window-slider");
const windowVal = $("#window-val");
const updateWindowDisplay = () => (windowVal.textContent = String(WINDOW_STOPS[+slider.value]));

const penaltySlider = $("#penalty-slider");
const penaltyVal = $("#penalty-val");
const PENALTY_MAX = 5.0;
const penaltyFromSlider = () => (+penaltySlider.value / 10) * PENALTY_MAX;
const updatePenaltyDisplay = () => (penaltyVal.textContent = penaltyFromSlider().toFixed(2));

const applyBtn = $("#group-btn");
applyBtn.textContent = "Apply groups";

let state = null;
let rerunTimer = null;
const customLabels = new Map();
// Auto-assigned names from the last naming pass, keyed by groupKey.
const autoNames = new Map();

function groupKey(group) {
  return group.map((t) => t.id).sort((a, b) => a - b).join(",");
}

function labelFor(group) {
  const key = groupKey(group);
  if (customLabels.has(key)) return customLabels.get(key);
  return autoNames.get(key) || "group";
}

const OPTIONS_KEY = "arctictab:options";
const OPTIONS_DEFAULTS = {
  excludePinned: true,
  rearrange: false,
  nameStyle: "mixed",
  headSim: 0.22,
  curatedSim: 0.27,
  keywordFrac: 0.34,
};
let options = { ...OPTIONS_DEFAULTS };
async function loadOptions() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  options = { ...OPTIONS_DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  log("options loaded", options);
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[OPTIONS_KEY]) return;
  options = { ...OPTIONS_DEFAULTS, ...(changes[OPTIONS_KEY].newValue || {}) };
  log("options updated", options);
  scheduleRefresh("options-changed");
});

$("#opts-btn").addEventListener("click", () => browser.runtime.openOptionsPage());

const SETTINGS_KEY = "arctictab:settings";
async function loadSettings() {
  try {
    const s = await browser.storage.local.get(SETTINGS_KEY);
    const v = s[SETTINGS_KEY];
    if (v && typeof v === "object") {
      if (typeof v.window === "number") slider.value = String(v.window);
      if (typeof v.penalty === "number") penaltySlider.value = String(v.penalty);
    }
  } catch (e) {
    console.warn("[arctictab] loadSettings failed", e);
  }
}
function saveSettings() {
  browser.storage.local.set({
    [SETTINGS_KEY]: { window: +slider.value, penalty: +penaltySlider.value },
  }).catch((e) => console.warn("[arctictab] saveSettings failed", e));
}

slider.addEventListener("input", () => { updateWindowDisplay(); saveSettings(); scheduleRecluster(); });
penaltySlider.addEventListener("input", () => { updatePenaltyDisplay(); saveSettings(); scheduleRecluster(); });
loadSettings().then(() => { updateWindowDisplay(); updatePenaltyDisplay(); });
updateWindowDisplay();
updatePenaltyDisplay();

onExtractorProgress((p) => {
  if (!p || !p.status) return;
  if (p.status === "progress" && typeof p.progress === "number") {
    status(`model: ${p.file || ""} ${p.progress.toFixed(0)}%`);
  } else if (p.status === "ready" || p.status === "done") {
    status(`model: ${p.status}`);
  } else {
    status(`model: ${p.status}${p.file ? " " + p.file : ""}`);
  }
});

applyBtn.addEventListener("click", async () => {
  if (!state?.lastGroups) return;
  applyBtn.disabled = true;
  try {
    status("applying tab groups...");
    await applyTabGroups(state.lastGroups);
    status(`applied ${state.lastGroups.length} groups.`);
  } catch (e) {
    console.error(e);
    status("apply error: " + (e?.message || e));
  } finally {
    applyBtn.disabled = false;
  }
});

function scheduleRecluster() {
  if (!state) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    recluster().catch((e) => { console.error(e); status("error: " + (e?.message || e)); });
  }, 80);
}

async function recluster() {
  console.assert(state != null, "state must exist");
  const { tabs, embeddings, texts } = state;
  const target = WINDOW_STOPS[+slider.value];
  const sizePenalty = penaltyFromSlider();
  log(`recluster: ${tabs.length} tabs, target=${target}, penalty=${sizePenalty.toFixed(2)}`);
  const { groups, threshold, avg, iterations } = detectExcursionsTargeted(
    tabs,
    embeddings,
    { targetAvgSize: target, sizePenalty },
  );
  state.lastGroups = groups;
  log(`recluster result: ${groups.length} groups, avg ${avg.toFixed(1)}, thr ${threshold.toFixed(2)}`);
  const currentKeys = new Set(groups.map(groupKey));
  for (const k of customLabels.keys()) if (!currentKeys.has(k)) customLabels.delete(k);
  await assignNames(groups, texts, tabs, embeddings);
  renderGroups(groups);
  status(
    `${groups.length} groups, avg ${avg.toFixed(1)} (target ${target}, thr ${threshold.toFixed(2)}, ${iterations} iter)`,
  );
}

async function assignNames(groups, texts, tabs, embeddings) {
  const tabIdxById = new Map(tabs.map((t, i) => [t.id, i]));
  let names;
  try {
    names = await nameGroups(
      groups,
      { tabIdxById, embeddings, texts },
      {
        style: options.nameStyle,
        headSim: options.headSim,
        curatedSim: options.curatedSim,
        keywordFrac: options.keywordFrac,
      },
    );
  } catch (e) {
    console.error("[arctictab] naming failed", e);
    names = groups.map(() => "group");
  }
  autoNames.clear();
  groups.forEach((g, i) => autoNames.set(groupKey(g), names[i]));
}

const log = (...args) => console.log("[arctictab]", ...args);

async function queryTabs(retries = 3) {
  const filter = (tabs) => options.excludePinned ? tabs.filter((t) => !t.pinned) : tabs;
  for (let attempt = 0; attempt < retries; attempt++) {
    const all = await browser.tabs.query({ currentWindow: true });
    const tabs = filter(all);
    log(`queryTabs attempt ${attempt + 1}: got ${all.length} tabs (${tabs.length} after pinned filter)`);
    if (tabs.length > 0) return tabs;
    await new Promise((r) => setTimeout(r, 200));
  }
  const all = await browser.tabs.query({ currentWindow: true });
  return filter(all);
}

let refreshId = 0;
async function refresh({ silent = false } = {}) {
  const id = ++refreshId;
  log(`refresh #${id} start (silent=${silent})`);
  if (!silent) {
    status("loading model...");
    $("#groups").innerHTML = '<div class="placeholder">Loading model and embedding tabs...</div>';
  }
  const t0 = performance.now();
  await getExtractor();
  log(`refresh #${id} model ready in ${(performance.now() - t0).toFixed(0)}ms`);

  if (!silent) status("collecting tabs...");
  const tabs = await queryTabs();
  log(`refresh #${id} tabs:`, tabs.length);
  if (tabs.length === 0) {
    status("no tabs found in this window");
    $("#groups").innerHTML = '<div class="placeholder">No tabs found.</div>';
    return;
  }

  if (!silent) status(`scraping metadata for ${tabs.length} tabs...`);
  const tMeta = performance.now();
  const metas = await Promise.all(tabs.map(getMeta));
  const texts = tabs.map((t, i) => buildText(t, metas[i]));
  log(`refresh #${id} metas done in ${(performance.now() - tMeta).toFixed(0)}ms, ${metas.filter(Boolean).length}/${tabs.length} had meta`);

  const cached = await getMany(tabs.map((t) => t.url));
  const embeddings = new Array(tabs.length);
  const toEmbedIdx = [];
  const toEmbedTexts = [];
  for (let i = 0; i < tabs.length; i++) {
    if (cached[i] && cached[i].text === texts[i]) {
      embeddings[i] = cached[i].embedding;
    } else {
      toEmbedIdx.push(i);
      toEmbedTexts.push(texts[i]);
    }
  }
  log(`refresh #${id} cache: ${tabs.length - toEmbedIdx.length} hits, ${toEmbedIdx.length} misses`);

  if (toEmbedTexts.length) {
    if (!silent) status(`embedding ${toEmbedTexts.length} tabs...`);
    const batchSize = 16;
    const tEmb = performance.now();
    for (let i = 0; i < toEmbedTexts.length; i += batchSize) {
      const batch = toEmbedTexts.slice(i, i + batchSize);
      const embs = await embedBatch(batch);
      for (let j = 0; j < embs.length; j++) {
        const idx = toEmbedIdx[i + j];
        embeddings[idx] = embs[j];
        await put(tabs[idx].url, embs[j], texts[idx]);
      }
      if (!silent) status(`embedded ${Math.min(i + batchSize, toEmbedTexts.length)}/${toEmbedTexts.length}`);
    }
    log(`refresh #${id} embedding done in ${(performance.now() - tEmb).toFixed(0)}ms`);
  }

  const missing = embeddings.findIndex((e) => !e);
  if (missing !== -1) {
    log(`refresh #${id} ERROR: missing embedding at index ${missing}, tab:`, tabs[missing]);
    status(`error: missing embedding at idx ${missing}`);
    return;
  }

  state = { tabs, embeddings, texts, lastGroups: null };
  log(`refresh #${id} state set, calling recluster`);
  await recluster();
  log(`refresh #${id} done`);
}

let refreshTimer = null;
let refreshing = false;
let refreshPending = false;
function scheduleRefresh(source) {
  log("scheduleRefresh from", source, "refreshing=", refreshing, "pending=", refreshPending);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    log("refreshTimer fired (source=", source, "refreshing=", refreshing, ")");
    if (refreshing) { refreshPending = true; log("refresh already running, queueing"); return; }
    refreshing = true;
    try {
      log("refreshTimer: calling refresh({silent:true})");
      await refresh({ silent: true });
      log("refreshTimer: refresh done");
    }
    catch (e) { console.error("[arctictab] refresh error:", e); status("refresh error: " + (e?.message || e)); }
    finally {
      refreshing = false;
      if (refreshPending) { refreshPending = false; log("refreshTimer: re-scheduling pending"); scheduleRefresh("pending"); }
    }
  }, 600);
}

log("registering tabs.* listeners");
browser.tabs.onCreated.addListener((t) => { log("tabs.onCreated", t.id, t.url); scheduleRefresh("onCreated"); });
browser.tabs.onRemoved.addListener((id) => { log("tabs.onRemoved", id); scheduleRefresh("onRemoved"); });
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  log("tabs.onUpdated raw", tabId, changeInfo);
  if (changeInfo.url || changeInfo.title || changeInfo.status === "complete") {
    log("tabs.onUpdated trigger", tabId, changeInfo);
    scheduleRefresh("onUpdated");
  }
});
log("tabs.* listeners registered");

async function getMeta(tab) {
  if (!tab.url || tab.url.startsWith("about:") || tab.url.startsWith("chrome:")) return null;
  try {
    return await browser.runtime.sendMessage({ type: "extractMeta", tabId: tab.id });
  } catch {
    return null;
  }
}

function isGroupable(tab) {
  const u = tab.url || "";
  return !u.startsWith("about:") && !u.startsWith("chrome:") && !u.startsWith("moz-extension:");
}

async function applyTabGroups(groups) {
  if (options.rearrange) {
    const ordered = [];
    for (const g of groups) for (const t of g) if (isGroupable(t)) ordered.push(t.id);
    log(`rearrange: moving ${ordered.length} tabs to cluster order`);
    try { await browser.tabs.move(ordered, { index: -1 }); }
    catch (e) { console.warn("rearrange failed", e); }
  }
  for (const g of groups) {
    const groupable = g.filter(isGroupable);
    if (groupable.length < 2) continue;
    const label = labelFor(g);
    const ids = groupable.map((t) => t.id);
    try {
      const gid = await browser.tabs.group({ tabIds: ids });
      await browser.tabGroups.update(gid, { title: label });
    } catch (e) {
      console.warn("tab grouping failed for", label, e);
    }
  }
}

function renderGroups(groups) {
  const main = $("#groups");
  main.innerHTML = "";
  for (const g of groups) {
    const div = document.createElement("div");
    div.className = "group";

    const header = document.createElement("div");
    header.className = "group-header";
    const label = labelFor(g);
    const title = document.createElement("h3");
    title.textContent = label;
    title.contentEditable = "true";
    title.spellcheck = false;
    title.title = "Click to rename";
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); title.blur(); }
      if (e.key === "Escape") { title.textContent = labelFor(g); title.blur(); }
    });
    title.addEventListener("blur", () => {
      const newLabel = title.textContent.trim();
      if (!newLabel) { title.textContent = labelFor(g); return; }
      customLabels.set(groupKey(g), newLabel);
    });
    header.appendChild(title);

    const star = document.createElement("button");
    star.className = "g-btn";
    star.title = "Bookmark group";
    star.textContent = "★";
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      bookmarkGroup(title.textContent.trim() || label, g);
    });
    header.appendChild(star);

    const close = document.createElement("button");
    close.className = "g-btn";
    close.title = "Close group";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeGroup(g);
    });
    header.appendChild(close);

    div.appendChild(header);

    for (const t of g) {
      const row = document.createElement("div");
      row.className = "tab";
      const fav = document.createElement("img");
      fav.className = "favicon";
      fav.alt = "";
      fav.referrerPolicy = "no-referrer";
      fav.src = faviconUrlFor(t);
      fav.addEventListener("error", () => { fav.src = fallbackFaviconUrl(t); });
      const titleSpan = document.createElement("span");
      titleSpan.className = "title";
      titleSpan.textContent = t.title || t.url;
      const hostSpan = document.createElement("span");
      hostSpan.className = "host";
      try { hostSpan.textContent = new URL(t.url).hostname.replace(/^www\./, ""); } catch {}
      const closeTabBtn = document.createElement("button");
      closeTabBtn.className = "t-btn";
      closeTabBtn.title = "Close tab";
      closeTabBtn.textContent = "×";
      closeTabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTabs([t.id]);
      });
      row.appendChild(fav);
      row.appendChild(titleSpan);
      row.appendChild(hostSpan);
      row.appendChild(closeTabBtn);
      row.addEventListener("click", () => browser.tabs.update(t.id, { active: true }));
      div.appendChild(row);
    }
    main.appendChild(div);
  }
}

const TRANSPARENT_PX = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2014%2014%22%3E%3Crect%20width%3D%2214%22%20height%3D%2214%22%20rx%3D%223%22%20fill%3D%22%23999%22%20opacity%3D%220.25%22%2F%3E%3C%2Fsvg%3E";

function faviconUrlFor(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome:")) return tab.favIconUrl;
  return fallbackFaviconUrl(tab);
}
function fallbackFaviconUrl(tab) {
  try {
    const u = new URL(tab.url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `${u.origin}/favicon.ico`;
    }
  } catch {}
  return TRANSPARENT_PX;
}

async function bookmarkGroup(label, groupTabs) {
  const bookmarkable = groupTabs.filter((t) => t.url && !t.url.startsWith("about:") && !t.url.startsWith("chrome:"));
  if (!bookmarkable.length) { status("nothing to bookmark."); return; }
  try {
    const folder = await browser.bookmarks.create({ title: `arctictab: ${label}` });
    for (const t of bookmarkable) {
      await browser.bookmarks.create({ parentId: folder.id, title: t.title || t.url, url: t.url });
    }
    status(`bookmarked ${bookmarkable.length} → "${label}"`);
  } catch (e) {
    console.error(e);
    status("bookmark error: " + (e?.message || e));
  }
}

async function closeTabs(ids) {
  try {
    await browser.tabs.remove(ids);
    if (state) {
      const remove = new Set(ids);
      const keep = (arr) => arr.filter((_, i) => !remove.has(state.tabs[i].id));
      const newTabs = state.tabs.filter((t) => !remove.has(t.id));
      const newEmbeddings = keep(state.embeddings);
      const newTexts = keep(state.texts);
      state = { tabs: newTabs, embeddings: newEmbeddings, texts: newTexts, lastGroups: null };
      await recluster();
    }
  } catch (e) {
    console.error(e);
    status("close error: " + (e?.message || e));
  }
}

async function closeGroup(groupTabs) {
  await closeTabs(groupTabs.map((t) => t.id));
}

log("sidebar.js loaded, calling initial refresh");
refreshing = true;
loadOptions()
  .catch((e) => console.warn("[arctictab] loadOptions failed", e))
  .then(() => refresh())
  .catch((e) => {
    console.error("[arctictab] init error:", e);
    status("init error: " + (e?.message || e));
  })
  .finally(() => {
    refreshing = false;
    if (refreshPending) { refreshPending = false; log("init refresh: re-scheduling pending"); scheduleRefresh("init-pending"); }
    log("init refresh complete");
  });
