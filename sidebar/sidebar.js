import { buildText, embedBatch, getExtractor, onExtractorProgress } from "../lib/embed.js";
import { getMany, put } from "../lib/cache.js";
import { detectExcursions, detectExcursionsTargeted, WINDOW_STOPS } from "../lib/cluster.js";
import { nameGroups } from "../lib/names.js";

const $ = (s) => document.querySelector(s);
let statusEl = null;
let statusHideTimer = null;
const status = (m) => {
  console.log("[arctictab][status]", m);
  statusEl = statusEl || document.getElementById("status-line");
  if (!statusEl) return;
  statusEl.textContent = m;
  statusEl.classList.remove("hidden");
  clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => statusEl.classList.add("hidden"), 6000);
};

const slider = $("#window-slider");
const windowVal = $("#window-val");
const updateWindowDisplay = () => (windowVal.textContent = String(WINDOW_STOPS[+slider.value]));

const penaltySlider = $("#penalty-slider");
const penaltyVal = $("#penalty-val");
const PENALTY_MAX = 5.0;
const penaltyFromSlider = () => (+penaltySlider.value / 10) * PENALTY_MAX;
const updatePenaltyDisplay = () => (penaltyVal.textContent = penaltyFromSlider().toFixed(2));

const controlChk = $("#control-size-chk");
const sizeControls = $("#size-controls");
const FREE_THRESHOLD = 0.5;
const applyControlVisibility = () => sizeControls.classList.toggle("hidden", !controlChk.checked);

const applyBtn = $("#group-btn");
applyBtn.textContent = "Apply groups";
const rearrangeBtn = $("#rearrange-btn");

let state = null;
let rerunTimer = null;
let autoApplying = false;
let suppressMoveRefresh = 0;
function suppressMovesFor(ms) {
  suppressMoveRefresh++;
  setTimeout(() => { suppressMoveRefresh--; }, ms);
}
const customLabels = new Map();
// Auto-assigned names from the last naming pass, keyed by groupKey.
const autoNames = new Map();
let lastLoggedFingerprint = null;

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
  hideApplyGroups: false,
  hideRearrange: false,
  autoApplyGroups: false,
  nameStyle: "mixed",
  headSim: 0.22,
  curatedSim: 0.27,
  keywordFrac: 0.34,
};
let options = { ...OPTIONS_DEFAULTS };
function applyButtonVisibility() {
  applyBtn.classList.toggle("hidden", !!options.hideApplyGroups);
  rearrangeBtn.classList.toggle("hidden", !!options.hideRearrange);
}
async function loadOptions() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  options = { ...OPTIONS_DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  log("options loaded", options);
  applyButtonVisibility();
}
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[OPTIONS_KEY]) return;
  options = { ...OPTIONS_DEFAULTS, ...(changes[OPTIONS_KEY].newValue || {}) };
  log("options updated", options);
  applyButtonVisibility();
  scheduleRefresh("options-changed");
});

$("#opts-btn").addEventListener("click", () => browser.runtime.openOptionsPage());

document.addEventListener("mousedown", (e) => {
  const row = e.target.closest?.(".tab");
  console.log("[arctictab][probe] document mousedown", e.target?.tagName, e.target?.className, "row?", !!row, row ? `draggable=${row.getAttribute("draggable")}` : "");
}, true);
document.addEventListener("dragstart", (e) => {
  console.log("[arctictab][probe] document dragstart", e.target?.tagName, e.target?.className);
}, true);

const SETTINGS_KEY = "arctictab:settings";
async function loadSettings() {
  try {
    const s = await browser.storage.local.get(SETTINGS_KEY);
    const v = s[SETTINGS_KEY];
    if (v && typeof v === "object") {
      if (typeof v.window === "number") slider.value = String(v.window);
      if (typeof v.penalty === "number") penaltySlider.value = String(v.penalty);
      if (typeof v.controlSize === "boolean") controlChk.checked = v.controlSize;
    }
  } catch (e) {
    console.warn("[arctictab] loadSettings failed", e);
  }
}
function saveSettings() {
  browser.storage.local.set({
    [SETTINGS_KEY]: {
      window: +slider.value,
      penalty: +penaltySlider.value,
      controlSize: controlChk.checked,
    },
  }).catch((e) => console.warn("[arctictab] saveSettings failed", e));
}

slider.addEventListener("input", () => { updateWindowDisplay(); saveSettings(); scheduleRecluster(); });
penaltySlider.addEventListener("input", () => { updatePenaltyDisplay(); saveSettings(); scheduleRecluster(); });
controlChk.addEventListener("change", () => { applyControlVisibility(); saveSettings(); scheduleRecluster(); });
loadSettings().then(() => { updateWindowDisplay(); updatePenaltyDisplay(); applyControlVisibility(); });
updateWindowDisplay();
updatePenaltyDisplay();
applyControlVisibility();

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

rearrangeBtn.addEventListener("click", async () => {
  if (!state?.lastGroups) return;
  rearrangeBtn.disabled = true;
  try {
    status("rearranging tabs...");
    await rearrangeTabs(state.lastGroups);
    status(`rearranged ${state.lastGroups.length} groups.`);
    scheduleRefresh("rearrange-done");
  } catch (e) {
    console.error(e);
    status("rearrange error: " + (e?.message || e));
  } finally {
    rearrangeBtn.disabled = false;
  }
});

const logsBtn = $("#logs-btn");
logsBtn.addEventListener("click", async () => {
  logsBtn.disabled = true;
  try {
    status("downloading logs + snapshot...");
    await flushLogsNow();
    await logTabSnapshot({ force: true });
    status("logs downloaded.");
  } catch (e) {
    console.error(e);
    status("log download error: " + (e?.message || e));
  } finally {
    logsBtn.disabled = false;
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
  let groups, threshold, avg, iterations, statusMsg;
  if (controlChk.checked) {
    const target = WINDOW_STOPS[+slider.value];
    const sizePenalty = penaltyFromSlider();
    log(`recluster: ${tabs.length} tabs, target=${target}, penalty=${sizePenalty.toFixed(2)}`);
    ({ groups, threshold, avg, iterations } = detectExcursionsTargeted(
      tabs,
      embeddings,
      { targetAvgSize: target, sizePenalty },
    ));
    statusMsg = `${groups.length} groups, avg ${avg.toFixed(1)} (target ${target}, thr ${threshold.toFixed(2)}, ${iterations} iter)`;
  } else {
    log(`recluster (auto): ${tabs.length} tabs, thr=${FREE_THRESHOLD}`);
    groups = detectExcursions(tabs, embeddings, { cosineDropThreshold: FREE_THRESHOLD });
    threshold = FREE_THRESHOLD;
    avg = tabs.length / Math.max(1, groups.length);
    statusMsg = `${groups.length} groups, avg ${avg.toFixed(1)} (auto, thr ${threshold.toFixed(2)})`;
  }
  state.lastGroups = groups;
  state.clusterResult = { threshold, avg, iterations };
  log(`recluster result: ${groups.length} groups, avg ${avg.toFixed(1)}, thr ${threshold.toFixed(2)}`);
  const currentKeys = new Set(groups.map(groupKey));
  for (const k of customLabels.keys()) if (!currentKeys.has(k)) customLabels.delete(k);
  await assignNames(groups, texts, tabs, embeddings);
  renderGroups(groups);
  status(statusMsg);
  logTabSnapshot();
  if (options.autoApplyGroups && !autoApplying) {
    autoApplying = true;
    try { await applyTabGroups(groups); }
    catch (e) { console.warn("[arctictab] auto-apply failed", e); }
    finally { autoApplying = false; }
  }
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

const LOG_DIR_PREFIX = "arctictab";
const SESSION_START_ISO = new Date().toISOString().replace(/[:.]/g, "-");
const SESSION_LOG_NAME = `${LOG_DIR_PREFIX}/session-${SESSION_START_ISO}.log`;
const LOG_FLUSH_MS = 30 * 1000;
const logBuffer = [];
let logFlushTimer = null;

async function downloadBlob(filename, blob, conflictAction) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, conflictAction, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function flushLogsNow() {
  if (logFlushTimer != null) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (!logBuffer.length) return;
  const text = logBuffer.join("");
  await downloadBlob(SESSION_LOG_NAME, new Blob([text], { type: "text/plain" }), "overwrite");
}

function scheduleLogFlush() {
  if (logFlushTimer != null) return;
  logFlushTimer = setTimeout(async () => {
    logFlushTimer = null;
    try { await flushLogsNow(); }
    catch (e) { console.warn("[arctictab] session log flush failed", e); }
  }, LOG_FLUSH_MS);
}

const log = (...args) => {
  console.log("[arctictab]", ...args);
  const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
  logBuffer.push(`${new Date().toISOString()} [arctictab] ${parts.join(" ")}\n`);
  scheduleLogFlush();
};

function groupCentroid(group, tabIdxById, embeddings) {
  const dim = embeddings[0].length;
  const c = new Float32Array(dim);
  for (const t of group) {
    const e = embeddings[tabIdxById.get(t.id)];
    for (let k = 0; k < dim; k++) c[k] += e[k];
  }
  let n = 0;
  for (let k = 0; k < dim; k++) n += c[k] * c[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) c[k] /= n;
  return c;
}

async function logTabSnapshot({ force = false } = {}) {
  if (!state?.lastGroups?.length) return;

  const fingerprint = state.lastGroups.map(groupKey).sort().join("|");
  if (!force && fingerprint === lastLoggedFingerprint) return;
  lastLoggedFingerprint = fingerprint;

  const tabIdxById = new Map(state.tabs.map((t, i) => [t.id, i]));

  const snapshot = {
    timestamp: new Date().toISOString(),
    tabCount: state.tabs.length,
    groupCount: state.lastGroups.length,
    settings: {
      windowTarget: WINDOW_STOPS[+slider.value],
      sizePenalty: penaltyFromSlider(),
      ...options,
    },
    clusterResult: state.clusterResult ?? null,
    tabs: state.tabs.map((t, i) => ({
      id: t.id,
      index: t.index,
      url: t.url,
      title: t.title,
      text: state.texts[i],
      embedding: Array.from(state.embeddings[i]),
    })),
    groups: state.lastGroups.map((g) => {
      const key = groupKey(g);
      return {
        name: autoNames.get(key) || customLabels.get(key) || "group",
        tabIds: g.map((t) => t.id),
        centroid: Array.from(groupCentroid(g, tabIdxById, state.embeddings)),
      };
    }),
  };

  const json = JSON.stringify(snapshot);
  console.log("[arctictab][snapshot]", json);
  const fname = `${LOG_DIR_PREFIX}/snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  try {
    await downloadBlob(fname, new Blob([json], { type: "application/json" }), "uniquify");
    log(`snapshot saved to ${fname}`);
  } catch (e) {
    console.warn("[arctictab] snapshot save failed", e);
  }
}

setInterval(logTabSnapshot, 30 * 60 * 1000);

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
browser.tabs.onMoved.addListener((id, info) => {
  log("tabs.onMoved", id, info);
  if (suppressMoveRefresh > 0) { log("tabs.onMoved suppressed (self-move)"); return; }
  scheduleRefresh("onMoved");
});
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

async function reorderTabByDrop(sourceId, targetId, before) {
  try {
    const [src, tgt] = await Promise.all([
      browser.tabs.get(sourceId),
      browser.tabs.get(targetId),
    ]);
    let newIndex = before ? tgt.index : tgt.index + 1;
    if (src.index < tgt.index) newIndex--;
    log(`drag: tab ${sourceId} (idx ${src.index}) -> ${targetId} (idx ${tgt.index}, before=${before}) => index ${newIndex}`);
    suppressMoveRefresh++;
    try { await browser.tabs.move(sourceId, { index: newIndex }); }
    finally { setTimeout(() => { suppressMoveRefresh--; }, 250); }
    status(`moved tab to index ${newIndex}`);
    scheduleRefresh("drag-drop");
  } catch (e) {
    console.error("reorderTabByDrop failed", e);
    log(`drag error: ${e?.message || e}`);
    status("drag error: " + (e?.message || e));
  }
}

async function ungroupAll(tabIds) {
  if (!browser.tabs.ungroup) { log("ungroupAll: tabs.ungroup unsupported"); return; }
  try {
    await browser.tabs.ungroup(tabIds);
    log(`ungroupAll: ${tabIds.length} tabs removed from any existing group`);
  } catch (e) {
    log(`ungroupAll failed: ${e?.message || e}`);
  }
}

async function snapshotTabOrder(label, ids) {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const byId = new Map(tabs.map((t) => [t.id, t.index]));
    const idxs = ids.map((id) => byId.get(id));
    log(`tab-order [${label}]: ${ids.length} ids → indices [${idxs.join(",")}]`);
  } catch (e) { log(`tab-order [${label}] failed: ${e?.message || e}`); }
}

async function rearrangeTabs(groups) {
  const ordered = [];
  for (const g of groups) for (const t of g) if (isGroupable(t)) ordered.push(t.id);
  log(`rearrange: ${ordered.length} tabs target cluster order`);

  const currentTabs = await browser.tabs.query({ currentWindow: true });
  const orderedSet = new Set(ordered);
  const liveOrder = currentTabs
    .filter((t) => orderedSet.has(t.id))
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id);
  const alreadyOrdered = liveOrder.length === ordered.length
    && liveOrder.every((id, i) => id === ordered[i]);
  if (alreadyOrdered) {
    log("rearrange: tabs already in cluster order, skipping moves");
    return;
  }

  suppressMoveRefresh++;
  try {
    await ungroupAll(ordered);
    await browser.tabs.move(ordered, { index: -1 });
    log("rearrange: move completed");
  } catch (e) { console.warn("rearrange failed", e); log(`rearrange error: ${e?.message || e}`); }
  finally { setTimeout(() => { suppressMoveRefresh--; }, 250); }
}

async function applyTabGroups(groups) {
  suppressMovesFor(500);
  if (options.rearrange) await rearrangeTabs(groups);
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
  const ordered = groups
    .map((g) => [...g].sort((a, b) => a.index - b.index))
    .sort((a, b) => a[0].index - b[0].index);
  for (const g of ordered) {
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
      row.setAttribute("draggable", "true");
      row.draggable = true;
      row.dataset.tabId = String(t.id);
      row.title = `${t.title || ""}\n${t.url || ""}`.trim();
      row.addEventListener("mousedown", () => log(`mousedown on tab row ${t.id}`));
      row.addEventListener("dragstart", (e) => {
        log(`dragstart tab ${t.id}`);
        e.dataTransfer.setData("text/plain", String(t.id));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        document.querySelectorAll(".tab.drop-before, .tab.drop-after")
          .forEach((el) => el.classList.remove("drop-before", "drop-after"));
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = row.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        row.classList.toggle("drop-before", before);
        row.classList.toggle("drop-after", !before);
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-before", "drop-after");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const before = (e.clientY - r.top) < r.height / 2;
        row.classList.remove("drop-before", "drop-after");
        const sourceId = +e.dataTransfer.getData("text/plain");
        if (!sourceId || sourceId === t.id) return;
        await reorderTabByDrop(sourceId, t.id, before);
      });
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

async function findBookmarksToolbarId() {
  const tree = await browser.bookmarks.getTree();
  const root = tree[0];
  console.assert(root && Array.isArray(root.children), "bookmarks tree root must have children");
  const toolbar = root.children.find((n) => n.id === "toolbar_____" || /toolbar/i.test(n.title || ""));
  if (toolbar) return toolbar.id;
  const menu = root.children.find((n) => n.id === "menu________" || /menu/i.test(n.title || ""));
  return (menu || root.children[0]).id;
}

async function bookmarkGroup(label, groupTabs) {
  const bookmarkable = groupTabs.filter((t) => t.url && !t.url.startsWith("about:") && !t.url.startsWith("chrome:"));
  log(`bookmarkGroup "${label}": ${groupTabs.length} tabs, ${bookmarkable.length} bookmarkable`);
  if (!bookmarkable.length) { status("nothing to bookmark."); return; }
  try {
    const parentId = await findBookmarksToolbarId();
    log(`bookmarkGroup: creating folder in parent ${parentId}`);
    const folder = await browser.bookmarks.create({ parentId, title: `arctictab: ${label}` });
    for (const t of bookmarkable) {
      await browser.bookmarks.create({ parentId: folder.id, title: t.title || t.url, url: t.url });
    }
    log(`bookmarkGroup: ${bookmarkable.length} bookmarks created in folder ${folder.id}`);
    status(`bookmarked ${bookmarkable.length} → "${label}" (Bookmarks Toolbar)`);
  } catch (e) {
    console.error(e);
    log(`bookmarkGroup error: ${e?.message || e}`);
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
