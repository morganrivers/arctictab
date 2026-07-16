import { buildText, embedBatch, getExtractor, onExtractorProgress } from "../lib/embed.js";
import { getMany, put } from "../lib/cache.js";
import { detectExcursions, detectExcursionsTargeted, clusterByEmbeddings, clusterByEmbeddingsTargeted, orderGroupsBySimilarity, placeNewTab } from "../lib/cluster.js";
import { nameGroups } from "../lib/names.js";
import { initTheme } from "../lib/theme.js";
import { isGroupable, orderTabIdsForStrip, planGroupSync, mirrorLayout } from "../lib/taborder.js";

initTheme();

const $ = (s) => document.querySelector(s);
let statusEl = null;
let statusHideTimer = null;
const status = (m) => {
  console.log("[arctictab][status]", m);
  statusEl = statusEl || document.getElementById("status-line");
  if (!statusEl) return;
  if (options?.hideStatus) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = m;
  statusEl.classList.remove("hidden");
  clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => statusEl.classList.add("hidden"), 6000);
};

const slider = $("#window-slider");
const windowVal = $("#window-val");
const WINDOW_MIN = 1;
const WINDOW_MAX = 60;
const windowFromSlider = () => Math.max(WINDOW_MIN, Math.min(WINDOW_MAX, Math.round(+slider.value)));
const updateWindowDisplay = () => (windowVal.textContent = String(windowFromSlider()));

const PENALTY_STOPS = [0, 0.4, 0.8, 1.2, 2.4, 3.6, 4.8, 6, 12, 24, 48];
function penaltyFromSliderValue(raw) {
  const r = Math.max(0, Math.min(PENALTY_STOPS.length - 1, +raw));
  const lo = Math.floor(r);
  const hi = Math.min(PENALTY_STOPS.length - 1, lo + 1);
  const t = r - lo;
  const v = PENALTY_STOPS[lo] * (1 - t) + PENALTY_STOPS[hi] * t;
  return Math.round(v * 100) / 100;
}
function formatPenalty(v) {
  return v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

const penaltySlider = $("#penalty-slider");
const penaltyVal = $("#penalty-val");
const penaltyFromSlider = () => penaltyFromSliderValue(penaltySlider.value);
const updatePenaltyDisplay = () => (penaltyVal.textContent = formatPenalty(penaltyFromSlider()));

const smallPenaltySlider = $("#small-penalty-slider");
const smallPenaltyVal = $("#small-penalty-val");
const smallPenaltyFromSlider = () => penaltyFromSliderValue(smallPenaltySlider.value);
const updateSmallPenaltyDisplay = () => (smallPenaltyVal.textContent = formatPenalty(smallPenaltyFromSlider()));

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
  const pid = clusterPinId.get(key);
  if (pid != null) {
    const p = pinnedGroups.get(pid);
    if (p) return p.name;
  }
  if (customLabels.has(key)) return customLabels.get(key);
  return autoNames.get(key) || "group";
}

const OPTIONS_KEY = "arctictab:options";
const DEFAULT_AUTO_ANCHORS = [
  { tabs: 10, groups: 3 },
  { tabs: 15, groups: 4 },
  { tabs: 25, groups: 5 },
];
const OPTIONS_DEFAULTS = {
  excludePinned: true,
  groupBySimilarity: false,
  reorganizeGroups: false,
  hideApplyGroups: false,
  hideRearrange: false,
  hideGroupCount: false,
  hideTabCount: false,
  hideStatus: true,
  autoApplyGroups: false,
  autoApplyNaming: true,
  nameStyle: "mixed",
  headSim: 0.22,
  curatedSim: 0.27,
  keywordFrac: 0.34,
  autoGroupAnchors: DEFAULT_AUTO_ANCHORS,
  usePinning: true,
  useBookmark: false,
  autoPinTabOnDrag: true,
  autoPinGroupOnDrag: true,
};

const PINS_KEY = "arctictab:pins";
let pinnedGroups = new Map();
let nextPinGroupId = 1;
const clusterPinId = new Map();
let savePinsPending = false;
async function loadPins() {
  const r = await browser.storage.local.get(PINS_KEY);
  const v = r[PINS_KEY] || {};
  const liveTabs = await browser.tabs.query({ currentWindow: true });
  const liveIds = new Set(liveTabs.map((t) => t.id));
  const liveIdsByUrl = new Map();
  for (const t of liveTabs) {
    if (!t.url) continue;
    if (!liveIdsByUrl.has(t.url)) liveIdsByUrl.set(t.url, []);
    liveIdsByUrl.get(t.url).push(t.id);
  }
  const claimed = new Set();
  pinnedGroups = new Map();
  let recovered = 0;
  for (const [gidStr, g] of Object.entries(v.groups || {})) {
    const gid = +gidStr;
    const tabIds = [];
    for (const entry of g.tabs || []) {
      const savedId = typeof entry === "number" ? entry : entry?.id;
      if (typeof savedId === "number" && liveIds.has(savedId) && !claimed.has(savedId)) {
        tabIds.push(savedId);
        claimed.add(savedId);
        continue;
      }
      const url = entry?.url;
      if (url && liveIdsByUrl.has(url)) {
        const cand = liveIdsByUrl.get(url).find((id) => !claimed.has(id));
        if (cand != null) { tabIds.push(cand); claimed.add(cand); recovered++; }
      }
    }
    pinnedGroups.set(gid, { name: String(g.name || "group"), tabIds });
  }
  nextPinGroupId = Math.max(1, +v.nextPinGroupId || 1, ...pinnedGroups.keys()) + (pinnedGroups.size ? 1 : 0);
  log(`loaded ${pinnedGroups.size} pinned groups (${claimed.size} tabs matched, ${recovered} recovered by URL)`);
}
async function urlByTabIdMap() {
  if (state?.tabs?.length) return new Map(state.tabs.map((t) => [t.id, t.url || null]));
  const live = await browser.tabs.query({ currentWindow: true });
  return new Map(live.map((t) => [t.id, t.url || null]));
}
function savePinsSoon() {
  if (savePinsPending) return;
  savePinsPending = true;
  queueMicrotask(async () => {
    savePinsPending = false;
    try {
      const urlById = await urlByTabIdMap();
      await browser.storage.local.set({
        [PINS_KEY]: {
          groups: Object.fromEntries(
            [...pinnedGroups.entries()].map(([gid, g]) => [
              gid,
              {
                name: g.name,
                tabs: g.tabIds.map((id) => ({ id, url: urlById.get(id) ?? null })),
              },
            ]),
          ),
          nextPinGroupId,
        },
      });
    } catch (e) { console.warn("[arctictab] savePins failed", e); }
  });
}
function tabPinnedGroupId(tabId) {
  for (const [gid, g] of pinnedGroups) if (g.tabIds.includes(tabId)) return gid;
  return null;
}
function isTabPinned(tabId) { return tabPinnedGroupId(tabId) !== null; }
function createPinnedGroup(name, tabIds) {
  const gid = nextPinGroupId++;
  pinnedGroups.set(gid, { name, tabIds: [...new Set(tabIds)] });
  log(`pin-group create gid=${gid} "${name}" with ${tabIds.length} tabs`);
  return gid;
}
function pinTabIntoGroup(tabId, gid) {
  console.assert(pinnedGroups.has(gid), "pin target group must exist");
  for (const [otherGid, g] of pinnedGroups) {
    if (otherGid === gid) continue;
    const i = g.tabIds.indexOf(tabId);
    if (i !== -1) { g.tabIds.splice(i, 1); log(`pin-tab: detached tab ${tabId} from gid=${otherGid}`); }
  }
  const g = pinnedGroups.get(gid);
  if (!g.tabIds.includes(tabId)) { g.tabIds.push(tabId); log(`pin-tab: attached tab ${tabId} to gid=${gid}`); }
}
function unpinTab(tabId) {
  const gid = tabPinnedGroupId(tabId);
  if (gid == null) return;
  const g = pinnedGroups.get(gid);
  g.tabIds = g.tabIds.filter((id) => id !== tabId);
  log(`unpin-tab ${tabId} from gid=${gid} (remaining=${g.tabIds.length})`);
  savePinsSoon();
}
function unpinGroup(gid) {
  if (!pinnedGroups.has(gid)) return;
  log(`unpin-group gid=${gid}`);
  pinnedGroups.delete(gid);
  savePinsSoon();
}
function renamePinnedGroup(gid, name) {
  const g = pinnedGroups.get(gid);
  if (!g) return;
  g.name = name;
  savePinsSoon();
}
function postProcessPins(groups, allTabs) {
  clusterPinId.clear();
  if (pinnedGroups.size === 0) return groups;
  const tabById = new Map(allTabs.map((t) => [t.id, t]));
  const claimed = new Set();
  const pinnedClusters = [];
  for (const [gid, p] of [...pinnedGroups.entries()]) {
    const present = p.tabIds.map((id) => tabById.get(id)).filter(Boolean);
    if (!present.length) continue;
    pinnedClusters.push({ gid, tabs: present });
    for (const t of present) claimed.add(t.id);
  }
  const free = groups
    .map((g) => g.filter((t) => !claimed.has(t.id)))
    .filter((g) => g.length > 0);
  const combined = [
    ...pinnedClusters.map((pc) => ({ tabs: pc.tabs, gid: pc.gid })),
    ...free.map((fc) => ({ tabs: fc, gid: null })),
  ];
  combined.sort((a, b) => {
    const aMin = Math.min(...a.tabs.map((t) => t.index));
    const bMin = Math.min(...b.tabs.map((t) => t.index));
    return aMin - bMin;
  });
  for (const c of combined) if (c.gid != null) clusterPinId.set(groupKey(c.tabs), c.gid);
  return combined.map((c) => c.tabs);
}
function findContainingGroup(tabId, groups) {
  if (!groups) return null;
  for (const g of groups) if (g.some((t) => t.id === tabId)) return g;
  return null;
}

function computeAutoGroupCount(tabCount, anchors) {
  const list = (anchors && anchors.length ? anchors : DEFAULT_AUTO_ANCHORS)
    .filter((a) => a && a.tabs > 0 && a.groups > 0)
    .slice()
    .sort((a, b) => a.tabs - b.tabs);
  if (list.length === 0) return Math.max(1, Math.round(tabCount / 8));
  if (tabCount <= list[0].tabs) return list[0].groups;
  for (let i = 1; i < list.length; i++) {
    if (tabCount <= list[i].tabs) {
      const a = list[i - 1];
      const b = list[i];
      const t = (tabCount - a.tabs) / (b.tabs - a.tabs);
      return a.groups + t * (b.groups - a.groups);
    }
  }
  const n = list.length;
  const a = list[n - 2] || list[n - 1];
  const b = list[n - 1];
  const span = Math.max(1, b.tabs - a.tabs);
  const slope = (b.groups - a.groups) / span;
  return b.groups + (tabCount - b.tabs) * slope;
}
let options = { ...OPTIONS_DEFAULTS };
let appliedSnapshot = null;
function effectiveAutoApplyNaming() {
  return options.autoApplyGroups || options.autoApplyNaming;
}
// Pinning only makes sense when tabs get reorganized: a pin survives a move.
// Without the move path, honoring a pin only fragments a contiguous cluster into
// an ungroupable scatter, so pinning stays off unless reorganizing.
function pinningActive({ forceSimilarity = false } = {}) {
  return options.usePinning && (options.autoApplyGroups || forceSimilarity);
}
function applyButtonVisibility() {
  const autoSyncing = effectiveAutoApplyNaming();
  applyBtn.classList.toggle("hidden", !!options.hideApplyGroups || autoSyncing);
  rearrangeBtn.classList.toggle("hidden", !!options.hideRearrange);
  if (options.hideStatus) {
    statusEl = statusEl || document.getElementById("status-line");
    if (statusEl) statusEl.classList.add("hidden");
  }
  updateCountsDisplay();
}

function updateCountsDisplay() {
  const line = document.getElementById("counts-line");
  const groupEl = document.getElementById("group-count");
  const tabEl = document.getElementById("tab-count");
  if (!line || !groupEl || !tabEl) return;
  const groups = state?.lastGroups?.length ?? 0;
  const tabs = state?.tabs?.length ?? 0;
  groupEl.textContent = `${groups} group${groups === 1 ? "" : "s"}`;
  tabEl.textContent = `${tabs} tab${tabs === 1 ? "" : "s"}`;
  const showGroup = !options.hideGroupCount;
  const showTab = !options.hideTabCount;
  groupEl.classList.toggle("hidden", !showGroup);
  tabEl.classList.toggle("hidden", !showTab);
  line.classList.toggle("hidden", !showGroup && !showTab);
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
  resetRefreshFingerprints();
  scheduleRefresh("options-changed");
});

$("#opts-btn").addEventListener("click", () => browser.runtime.openOptionsPage());

document.addEventListener("mousedown", (e) => {
  const row = e.target.closest?.(".tab");
  console.log("[arctictab][probe] document mousedown", e.target?.tagName, e.target?.className, "row?", !!row, row ? `draggable=${row.getAttribute("draggable")}` : "");
}, true);
document.addEventListener("dragstart", (e) => {
  console.log("[arctictab][probe] document dragstart", e.target?.tagName, e.target?.className);
  document.body.classList.add("tab-dragging");
  for (const h of document.querySelectorAll(".group-header h3[contenteditable]")) {
    h.dataset.prevEditable = h.contentEditable;
    h.contentEditable = "false";
  }
}, true);
document.addEventListener("dragend", () => {
  document.body.classList.remove("tab-dragging");
  for (const h of document.querySelectorAll(".group-header h3[data-prev-editable]")) {
    h.contentEditable = h.dataset.prevEditable || "true";
    delete h.dataset.prevEditable;
  }
}, true);

const SETTINGS_KEY = "arctictab:settings";
async function loadSettings() {
  try {
    const s = await browser.storage.local.get(SETTINGS_KEY);
    const v = s[SETTINGS_KEY];
    if (v && typeof v === "object") {
      if (typeof v.window === "number") slider.value = String(v.window);
      if (typeof v.penalty === "number") penaltySlider.value = String(v.penalty);
      if (typeof v.smallPenalty === "number") smallPenaltySlider.value = String(v.smallPenalty);
      if (typeof v.controlSize === "boolean") controlChk.checked = v.controlSize;
    }
  } catch (e) {
    console.warn("[arctictab] loadSettings failed", e);
  }
}
function saveSettings() {
  browser.storage.local.set({
    [SETTINGS_KEY]: {
      window: windowFromSlider(),
      penalty: +penaltySlider.value,
      smallPenalty: +smallPenaltySlider.value,
      controlSize: controlChk.checked,
    },
  }).catch((e) => console.warn("[arctictab] saveSettings failed", e));
}

slider.addEventListener("input", () => { updateWindowDisplay(); saveSettings(); scheduleRecluster(); });
penaltySlider.addEventListener("input", () => { updatePenaltyDisplay(); saveSettings(); scheduleRecluster(); });
smallPenaltySlider.addEventListener("input", () => { updateSmallPenaltyDisplay(); saveSettings(); scheduleRecluster(); });
controlChk.addEventListener("change", () => { applyControlVisibility(); saveSettings(); scheduleRecluster(); });
loadSettings().then(() => { updateWindowDisplay(); updatePenaltyDisplay(); updateSmallPenaltyDisplay(); applyControlVisibility(); });
updateWindowDisplay();
updatePenaltyDisplay();
updateSmallPenaltyDisplay();
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
    if (!effectiveAutoApplyNaming()) {
      await assignNames(state.lastGroups, state.texts, state.tabs, state.embeddings);
    }
    updateAppliedSnapshot(state.lastGroups);
    await applyTabGroups(state.lastGroups, { rearrange: false });
    renderGroups(state.lastGroups);
    status(`applied ${state.lastGroups.length} groups.`);
  } catch (e) {
    console.error(e);
    status("apply error: " + (e?.message || e));
  } finally {
    applyBtn.disabled = false;
  }
});

rearrangeBtn.addEventListener("click", async () => {
  rearrangeBtn.disabled = true;
  try {
    status("recomputing best clusters...");
    skipNextAutoApply = true;
    await refresh({ silent: true, reclusterOpts: { forceSimilarity: true }, force: true });
    if (!state?.lastGroups?.length) {
      status("no clusters available to re-organize.");
      return;
    }
    if (!effectiveAutoApplyNaming()) {
      await assignNames(state.lastGroups, state.texts, state.tabs, state.embeddings);
      updateAppliedSnapshot(state.lastGroups);
    }
    status(`re-organizing into ${state.lastGroups.length} fresh clusters...`);
    const r = await applyTabGroups(state.lastGroups);
    if (r?.moved) status(`re-organized: moved ${r.moved} tabs into ${r.grouped} Firefox tab groups.`);
    else if (r?.grouped) status(`re-organized: ${r.grouped} Firefox tab groups applied (tabs already in order).`);
    else status(`re-organize: nothing to change.`);
    scheduleRefresh("rearrange-done");
  } catch (e) {
    console.error(e);
    status("re-organize error: " + (e?.message || e));
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

const copyStateBtn = $("#copy-state-btn");
copyStateBtn.addEventListener("click", async () => {
  copyStateBtn.disabled = true;
  try {
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const tabIdToGroupIdx = new Map();
    (state?.lastGroups || []).forEach((g, gi) => g.forEach((t) => tabIdToGroupIdx.set(t.id, gi)));
    const snapshot = {
      timestamp: new Date().toISOString(),
      options,
      sizeControl: { enabled: controlChk.checked, target: windowFromSlider(), penalty: penaltyFromSlider(), smallPenalty: smallPenaltyFromSlider() },
      windowTabs: allTabs
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          index: t.index,
          id: t.id,
          pinned: t.pinned,
          active: t.active,
          groupId: t.groupId ?? null,
          url: t.url,
          title: t.title,
          inClusterIdx: tabIdToGroupIdx.has(t.id) ? tabIdToGroupIdx.get(t.id) : null,
        })),
      clusterGroups: (state?.lastGroups || []).map((g, gi) => ({
        idx: gi,
        name: labelFor(g),
        tabIds: g.map((t) => t.id),
        urls: g.map((t) => t.url),
      })),
    };
    const json = JSON.stringify(snapshot, null, 2);
    await navigator.clipboard.writeText(json);
    log(`copy-state: ${snapshot.windowTabs.length} tabs, ${snapshot.clusterGroups.length} clusters → clipboard (${json.length} chars)`);
    status(`copied state: ${snapshot.windowTabs.length} tabs, ${snapshot.clusterGroups.length} clusters.`);
  } catch (e) {
    console.error(e);
    status("copy-state error: " + (e?.message || e));
  } finally {
    copyStateBtn.disabled = false;
  }
});

function scheduleRecluster() {
  if (!state) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    recluster().catch((e) => { console.error(e); status("error: " + (e?.message || e)); });
  }, 80);
}

// Similarity mode, mirror-safe: route one loose (singleton) tab into the tail of
// its most-similar multi-tab group. Only the loose tab moves, so existing tabs
// stay put and the strip stays a set of contiguous blocks. Returns true if it
// moved a tab (caller reschedules so the linear pass regroups it).
async function placeNewTabsBySimilarity(groups) {
  const multi = groups.filter((g) => g.length >= 2);
  if (!multi.length) return false;
  const embByTabId = new Map(state.tabs.map((t, i) => [t.id, state.embeddings[i]]));
  for (const g of groups) {
    if (g.length !== 1) continue;
    const t = g[0];
    const emb = embByTabId.get(t.id);
    if (!emb) continue;
    const res = placeNewTab(emb, multi, embByTabId);
    if (!res) continue;
    let target = res.targetIndex;
    if (t.index < target) target -= 1;
    if (target === t.index) continue;
    log(`similarity-place: tab ${t.id} (idx ${t.index}) → idx ${target} (sim ${res.similarity.toFixed(3)})`);
    suppressMovesFor(500);
    try { await browser.tabs.move(t.id, { index: target }); }
    catch (e) { log(`similarity-place: move failed: ${e?.message || e}`); continue; }
    return true;
  }
  return false;
}

async function recluster({ forceSimilarity = false } = {}) {
  console.assert(state != null, "state must exist");
  const { tabs, embeddings, texts } = state;
  const clusterTabs = [];
  const clusterEmbeddings = [];
  for (let i = 0; i < tabs.length; i++) {
    if (isGroupable(tabs[i])) { clusterTabs.push(tabs[i]); clusterEmbeddings.push(embeddings[i]); }
  }
  console.assert(clusterTabs.length === clusterEmbeddings.length, "cluster tabs/embeddings length mismatch");
  let groups, threshold, avg, iterations, statusMsg;
  // Only the explicit Re-organize action (forceSimilarity) may reshuffle existing
  // tabs by content. The auto path always stays linear/contiguous so the strip
  // mirror holds; similarity mode instead routes new tabs (below) into groups.
  const useSimilarity = forceSimilarity;
  const mode = useSimilarity ? "agglomerative" : "linear";
  if (clusterTabs.length === 0) {
    groups = [];
    threshold = 0; avg = 0; iterations = 0;
    statusMsg = "no groupable tabs";
  } else if (controlChk.checked) {
    const target = windowFromSlider();
    const sizePenalty = penaltyFromSlider();
    const smallSizePenalty = smallPenaltyFromSlider();
    log(`recluster (${mode}): ${clusterTabs.length} groupable tabs, target=${target}, penalty=${sizePenalty.toFixed(2)}, smallPenalty=${smallSizePenalty.toFixed(2)}`);
    const targetedFn = useSimilarity ? clusterByEmbeddingsTargeted : detectExcursionsTargeted;
    ({ groups, threshold, avg, iterations } = targetedFn(clusterTabs, clusterEmbeddings, { targetAvgSize: target, sizePenalty, smallSizePenalty }));
    statusMsg = `${groups.length} groups, avg ${avg.toFixed(1)} (${mode}, target ${target}, thr ${threshold.toFixed(2)}, ${iterations} iter)`;
  } else {
    const desired = Math.max(1, Math.round(computeAutoGroupCount(clusterTabs.length, options.autoGroupAnchors)));
    const target = Math.max(1, clusterTabs.length / desired);
    const sizePenalty = penaltyFromSlider();
    const smallSizePenalty = smallPenaltyFromSlider();
    log(`recluster (${mode}, auto): ${clusterTabs.length} groupable tabs → ${desired} groups, target=${target.toFixed(2)}, penalty=${sizePenalty.toFixed(2)}, smallPenalty=${smallSizePenalty.toFixed(2)}`);
    const targetedFn = useSimilarity ? clusterByEmbeddingsTargeted : detectExcursionsTargeted;
    ({ groups, threshold, avg, iterations } = targetedFn(clusterTabs, clusterEmbeddings, { targetAvgSize: target, sizePenalty, smallSizePenalty }));
    statusMsg = `${groups.length} groups, avg ${avg.toFixed(1)} (${mode}, auto target ${target.toFixed(1)} for ${desired})`;
  }
  if (pinningActive({ forceSimilarity })) groups = postProcessPins(groups, tabs);
  else clusterPinId.clear();
  if (options.groupBySimilarity && !forceSimilarity && state?.embeddings) {
    const moved = await placeNewTabsBySimilarity(groups);
    if (moved) { scheduleRefresh("similarity-place"); return; }
  }
  state.lastGroups = groups;
  state.clusterResult = { threshold, avg, iterations };
  log(`recluster result: ${groups.length} groups (${clusterPinId.size} pinned), avg ${avg.toFixed(1)}, thr ${threshold.toFixed(2)}`);
  const currentKeys = new Set(groups.map(groupKey));
  for (const k of customLabels.keys()) if (!currentKeys.has(k)) customLabels.delete(k);
  if (effectiveAutoApplyNaming()) {
    await assignNames(groups, texts, tabs, embeddings);
    updateAppliedSnapshot(groups);
  }
  renderGroups(groups);
  status(statusMsg);
  if (!autoApplying && !skipNextAutoApply) {
    if (options.autoApplyGroups) {
      autoApplying = true;
      try {
        const r = await applyTabGroups(groups, { captureUndo: false });
        if (r?.moved) status(`auto-apply: moved ${r.moved} tabs, ${r.grouped} groups.`);
        else if (r?.grouped) status(`auto-apply: ${r.grouped} groups applied (tabs already in order).`);
        else status(`auto-apply: nothing to change.`);
      }
      catch (e) { console.warn("[arctictab] auto-apply failed", e); }
      finally { autoApplying = false; }
    } else if (options.autoApplyNaming) {
      autoApplying = true;
      try {
        const r = await applyTabGroups(groups, { rearrange: false, captureUndo: false });
        if (r?.grouped) status(`auto-apply: ${r.grouped} groups synced.`);
        else status(`auto-apply: nothing to change.`);
      }
      catch (e) { console.warn("[arctictab] auto-apply (no rearrange) failed", e); }
      finally { autoApplying = false; }
    }
  } else if (skipNextAutoApply) {
    skipNextAutoApply = false;
    log("recluster: skipped one auto-apply (undo guard)");
  }
}

function updateAppliedSnapshot(groups) {
  appliedSnapshot = groups.map((g) => ({
    name: labelFor(g),
    tabIds: g.map((t) => t.id),
  }));
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
const logBuffer = [];

async function downloadBlob(filename, blob, conflictAction) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, conflictAction, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function flushLogsNow() {
  if (!logBuffer.length) return;
  const text = logBuffer.join("");
  await downloadBlob(SESSION_LOG_NAME, new Blob([text], { type: "text/plain" }), "overwrite");
}

const log = (...args) => {
  console.log("[arctictab]", ...args);
  const parts = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)));
  logBuffer.push(`${new Date().toISOString()} [arctictab] ${parts.join(" ")}\n`);
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
      windowTarget: windowFromSlider(),
      sizePenalty: penaltyFromSlider(),
      smallSizePenalty: smallPenaltyFromSlider(),
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
let lastTabsFingerprint = null;
let lastTextsFingerprint = null;

function stableTitle(title) {
  return (title || "").replace(/^\(\d+\)\s*/, "").trim();
}
function tabsFingerprint(tabs) {
  return tabs.map((t) => `${t.id}\x1f${t.index}\x1f${t.url || ""}\x1f${stableTitle(t.title)}\x1f${t.pinned ? 1 : 0}`).join("\x1e");
}
function textsFingerprintFor(tabs, texts) {
  return tabs.map((t, i) => `${t.id}\x1f${texts[i] || ""}`).join("\x1e");
}
function resetRefreshFingerprints() {
  lastTabsFingerprint = null;
  lastTextsFingerprint = null;
}

async function refresh({ silent = false, reclusterOpts = {}, force = false } = {}) {
  const id = ++refreshId;
  log(`refresh #${id} start (silent=${silent}, force=${force})`);
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

  const tabsFp = tabsFingerprint(tabs);
  if (!force && tabsFp === lastTabsFingerprint && state?.lastGroups) {
    log(`refresh #${id} skipped: tabs fingerprint unchanged`);
    return;
  }
  lastTabsFingerprint = tabsFp;

  if (!silent) status(`scraping metadata for ${tabs.length} tabs...`);
  const tMeta = performance.now();
  const metas = await Promise.all(tabs.map(getMeta));
  const texts = tabs.map((t, i) => buildText(t, metas[i]));
  log(`refresh #${id} metas done in ${(performance.now() - tMeta).toFixed(0)}ms, ${metas.filter(Boolean).length}/${tabs.length} had meta`);

  const textsFp = textsFingerprintFor(tabs, texts);
  if (!force && textsFp === lastTextsFingerprint && state?.lastGroups) {
    log(`refresh #${id} skipped: texts fingerprint unchanged`);
    return;
  }
  lastTextsFingerprint = textsFp;

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
  await recluster(reclusterOpts);
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
browser.tabs.onRemoved.addListener((id) => {
  log("tabs.onRemoved", id);
  let dirty = false;
  for (const [gid, g] of pinnedGroups) {
    const i = g.tabIds.indexOf(id);
    if (i !== -1) { g.tabIds.splice(i, 1); dirty = true; log(`pin cleanup: tab ${id} removed from pinned gid=${gid}`); }
  }
  if (dirty) savePinsSoon();
  scheduleRefresh("onRemoved");
});
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
let sidebarWindowId = null;
browser.windows.getCurrent().then((w) => { sidebarWindowId = w.id; });
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (sidebarWindowId !== null && windowId !== sidebarWindowId) return;
  for (const el of document.querySelectorAll(".tab.active")) el.classList.remove("active");
  const row = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  if (row) row.classList.add("active");
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

function ensurePinGroupForCluster(clusterTabs) {
  const key = groupKey(clusterTabs);
  const existing = clusterPinId.get(key);
  if (existing != null) return existing;
  const name = labelFor(clusterTabs);
  const gid = createPinnedGroup(name, clusterTabs.map((t) => t.id));
  clusterPinId.set(key, gid);
  return gid;
}

async function togglePinTab(tabId, containingGroup) {
  if (isTabPinned(tabId)) {
    unpinTab(tabId);
    status("tab unpinned.");
  } else {
    if (!containingGroup) { status("can't pin: tab is not in a cluster."); return; }
    const gid = ensurePinGroupForCluster(containingGroup);
    pinTabIntoGroup(tabId, gid);
    savePinsSoon();
    status("tab pinned.");
  }
  if (state?.lastGroups) renderGroups(state.lastGroups);
  scheduleRecluster();
}

function toggleGroupPin(clusterTabs, pinId) {
  if (pinId != null) {
    unpinGroup(pinId);
    status("group unpinned.");
  } else {
    const name = labelFor(clusterTabs);
    const gid = createPinnedGroup(name, clusterTabs.map((t) => t.id));
    clusterPinId.set(groupKey(clusterTabs), gid);
    savePinsSoon();
    status(`group pinned: "${name}".`);
  }
  if (state?.lastGroups) renderGroups(state.lastGroups);
  scheduleRecluster();
}

async function handleTabDrop(sourceId, targetId, before, targetGroup) {
  const sourceGroup = findContainingGroup(sourceId, state?.lastGroups);
  const crossGroup = !sourceGroup || sourceGroup !== targetGroup;
  if (pinningActive() && crossGroup && targetGroup) {
    const targetKey = groupKey(targetGroup);
    let targetGid = clusterPinId.get(targetKey);
    if (options.autoPinGroupOnDrag && targetGid == null) {
      targetGid = createPinnedGroup(labelFor(targetGroup), targetGroup.map((t) => t.id));
      clusterPinId.set(targetKey, targetGid);
      log(`drag auto-pinned group gid=${targetGid}`);
    }
    if (options.autoPinTabOnDrag) {
      if (targetGid == null) {
        targetGid = createPinnedGroup(labelFor(targetGroup), [sourceId]);
        clusterPinId.set(targetKey, targetGid);
        log(`drag auto-pinned solo-tab pin group gid=${targetGid}`);
      } else {
        pinTabIntoGroup(sourceId, targetGid);
      }
    }
    savePinsSoon();
  }
  await reorderTabByDrop(sourceId, targetId, before);
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

let lastUndoSnapshot = null;
let skipNextAutoApply = false;
const undoBtn = $("#undo-btn");

function setUndoEnabled(enabled) {
  if (undoBtn) undoBtn.disabled = !enabled;
}

async function captureUndoSnapshot(label, { closingTabIds = [] } = {}) {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((g) => g != null && g !== -1))];
    const groupMeta = new Map();
    if (browser.tabGroups?.get) {
      for (const gid of groupIds) {
        try {
          const g = await browser.tabGroups.get(gid);
          groupMeta.set(gid, { title: g.title || "", color: g.color || null });
        } catch (e) { log(`undo-snapshot: tabGroups.get(${gid}) failed: ${e?.message || e}`); }
      }
    }
    const closingSet = new Set(closingTabIds);
    const closedTabs = tabs
      .filter((t) => closingSet.has(t.id))
      .map((t) => ({
        origId: t.id,
        url: t.url,
        title: t.title || "",
        index: t.index,
        pinned: !!t.pinned,
        groupId: t.groupId ?? -1,
      }));
    const windowId = tabs[0]?.windowId;
    lastUndoSnapshot = {
      label,
      tabs: tabs.map((t) => ({ id: t.id, index: t.index, groupId: t.groupId ?? -1 })),
      groupMeta,
      closedTabs,
      windowId,
      timestamp: Date.now(),
    };
    setUndoEnabled(true);
    log(`undo-snapshot [${label}]: ${lastUndoSnapshot.tabs.length} tabs, ${groupIds.length} native groups, ${closedTabs.length} closing, windowId=${windowId}`);
    if (closingTabIds.length) {
      const missing = closingTabIds.filter((id) => !tabs.find((t) => t.id === id));
      if (missing.length) log(`undo-snapshot [${label}]: WARN ${missing.length} closingTabIds not found in window (ids: ${missing.join(",")})`);
    }
  } catch (e) {
    log(`undo-snapshot [${label}] failed: ${e?.message || e}`);
  }
}

async function applyUndoSnapshot() {
  if (!lastUndoSnapshot) { status("nothing to undo."); return; }
  const snap = lastUndoSnapshot;
  log(`undo: restoring snapshot [${snap.label}] (${snap.tabs.length} tabs)`);
  suppressMoveRefresh++;
  try {
    const closedIdMap = new Map();
    const sortedClosed = [...(snap.closedTabs || [])].sort((a, b) => a.index - b.index);
    log(`undo: snapshot has ${sortedClosed.length} closed tabs to reopen`);
    let recreated = 0;
    for (const c of sortedClosed) {
      try {
        const createArgs = {
          url: c.url,
          active: false,
          pinned: c.pinned,
          index: c.index,
        };
        if (snap.windowId != null) createArgs.windowId = snap.windowId;
        const created = await browser.tabs.create(createArgs);
        closedIdMap.set(c.origId, created.id);
        recreated++;
        log(`undo: recreated ${c.url} → new id ${created.id}`);
      } catch (e) {
        log(`undo: recreate ${c.url} failed: ${e?.message || e}`);
      }
    }

    const live = await browser.tabs.query({ currentWindow: true });
    const liveIds = new Set(live.map((t) => t.id));
    const restorable = snap.tabs
      .map((t) => {
        if (closedIdMap.has(t.id)) return { ...t, id: closedIdMap.get(t.id) };
        return liveIds.has(t.id) ? t : null;
      })
      .filter(Boolean);
    if (restorable.length !== snap.tabs.length) {
      log(`undo: ${snap.tabs.length - restorable.length} snapshotted tab(s) no longer exist; skipping those`);
    }

    if (browser.tabs.ungroup) {
      try { await browser.tabs.ungroup(restorable.map((t) => t.id)); }
      catch (e) { log(`undo: ungroup failed: ${e?.message || e}`); }
    }

    const sorted = [...restorable].sort((a, b) => a.index - b.index);
    for (const t of sorted) {
      try { await browser.tabs.move(t.id, { index: t.index }); }
      catch (e) { log(`undo: move tab ${t.id} → ${t.index} failed: ${e?.message || e}`); }
    }

    const byOrigGid = new Map();
    for (const t of restorable) {
      if (t.groupId == null || t.groupId === -1) continue;
      if (!byOrigGid.has(t.groupId)) byOrigGid.set(t.groupId, []);
      byOrigGid.get(t.groupId).push(t.id);
    }
    let regrouped = 0;
    for (const [origGid, ids] of byOrigGid) {
      if (ids.length < 1) continue;
      try {
        const newGid = await browser.tabs.group({ tabIds: ids });
        const meta = snap.groupMeta?.get(origGid);
        if (meta && browser.tabGroups?.update) {
          const update = {};
          if (meta.title) update.title = meta.title;
          if (meta.color) update.color = meta.color;
          if (Object.keys(update).length) await browser.tabGroups.update(newGid, update);
        }
        regrouped++;
      } catch (e) {
        log(`undo: regroup ${ids.length} tabs (orig gid ${origGid}) failed: ${e?.message || e}`);
      }
    }
    const reopenMsg = sortedClosed.length
      ? `, reopened ${recreated}/${sortedClosed.length} closed tab(s)`
      : "";
    status(`undid ${snap.label}: restored ${restorable.length} tabs, ${regrouped} groups${reopenMsg}.`);
    log(`undo complete: ${restorable.length} tabs restored, ${regrouped} groups recreated, ${recreated}/${sortedClosed.length} closed tabs reopened`);
  } catch (e) {
    console.error(e);
    status("undo error: " + (e?.message || e));
    log(`undo failed: ${e?.message || e}`);
  } finally {
    setTimeout(() => { suppressMoveRefresh--; }, 500);
    lastUndoSnapshot = null;
    setUndoEnabled(false);
    skipNextAutoApply = true;
    scheduleRefresh("undo-done");
  }
}

if (undoBtn) {
  undoBtn.addEventListener("click", async () => {
    undoBtn.disabled = true;
    try { await applyUndoSnapshot(); }
    finally { setUndoEnabled(!!lastUndoSnapshot); }
  });
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
  const ordered = orderTabIdsForStrip(groups, { groupBySimilarity: options.groupBySimilarity });
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
    return { moved: 0, total: ordered.length };
  }

  suppressMoveRefresh++;
  let moved = 0;
  try {
    await ungroupAll(ordered);
    await browser.tabs.move(ordered, { index: -1 });
    moved = ordered.length;
    log("rearrange: move completed");
  } catch (e) { console.warn("rearrange failed", e); log(`rearrange error: ${e?.message || e}`); }
  finally { setTimeout(() => { suppressMoveRefresh--; }, 250); }
  return { moved, total: ordered.length };
}

async function applyTabGroups(groups, { rearrange = true, captureUndo = true } = {}) {
  if (captureUndo) await captureUndoSnapshot("apply-groups");
  let moved = 0;
  let total = 0;
  if (rearrange) {
    if (options.reorganizeGroups && state?.tabs && state?.embeddings) {
      const before = groups.map((g) => g[0]?.id);
      groups = orderGroupsBySimilarity(groups, state.tabs, state.embeddings);
      const after = groups.map((g) => g[0]?.id);
      const changed = before.length !== after.length || before.some((id, i) => id !== after[i]);
      if (changed) log(`reorganize-groups: reordered ${groups.length} groups by similarity`);
    }
    suppressMovesFor(500);
    const r = await rearrangeTabs(groups);
    moved = r?.moved ?? 0;
    total = r?.total ?? 0;
  }
  const tabsNow = await browser.tabs.query({ currentWindow: true });
  const tabById = new Map(tabsNow.map((t) => [t.id, t]));
  const membersByGid = new Map();
  for (const t of tabsNow) {
    if (t.groupId == null || t.groupId === -1) continue;
    if (!membersByGid.has(t.groupId)) membersByGid.set(t.groupId, new Set());
    membersByGid.get(t.groupId).add(t.id);
  }
  const titleByGid = new Map();
  if (browser.tabGroups?.get) {
    for (const gid of membersByGid.keys()) {
      try { const tg = await browser.tabGroups.get(gid); titleByGid.set(gid, tg.title || ""); }
      catch (e) { log(`apply-groups: tabGroups.get(${gid}) failed: ${e?.message || e}`); }
    }
  }

  const plan = planGroupSync(tabsNow, groups);

  const groupByTabId = new Map();
  for (const g of groups) for (const t of g) groupByTabId.set(t.id, g);

  let grouped = 0;
  // ungroup/group relocate tabs to make each cluster a contiguous native group.
  // Suppress the resulting move events so they don't trigger a redundant refresh
  // mid-apply.
  suppressMoveRefresh++;
  try {
    if (plan.ungroup.length) {
      log(`apply-groups: ungrouping ${plan.ungroup.length} tabs no longer in a contiguous group`);
      await ungroupAll(plan.ungroup);
    }
    for (const { tabIds: ids } of plan.group) {
      const label = labelFor(groupByTabId.get(ids[0]));

      const currentGids = ids.map((id) => tabById.get(id)?.groupId ?? -1);
      const uniqueGids = [...new Set(currentGids)];
      const sharedGid = (uniqueGids.length === 1 && uniqueGids[0] !== -1) ? uniqueGids[0] : null;
      const existingMembers = sharedGid != null ? membersByGid.get(sharedGid) : null;
      const noExtras = !!existingMembers && existingMembers.size === ids.length;
      const titleMatches = sharedGid != null && titleByGid.get(sharedGid) === label;

      if (sharedGid != null && noExtras && titleMatches) {
        log(`apply-groups: "${label}" already correct, skipping`);
        grouped++;
        continue;
      }
      if (sharedGid != null && noExtras && !titleMatches) {
        try {
          await browser.tabGroups.update(sharedGid, { title: label });
          log(`apply-groups: "${label}" title-only update`);
          grouped++;
        } catch (e) { console.warn("tab group title update failed for", label, e); }
        continue;
      }

      try {
        const gid = await browser.tabs.group({ tabIds: ids });
        await browser.tabGroups.update(gid, { title: label });
        grouped++;
      } catch (e) {
        console.warn("tab grouping failed for", label, e);
      }
    }
  } finally {
    setTimeout(() => { suppressMoveRefresh--; }, 500);
  }
  return { moved, total, grouped };
}

function createTabRow(t, containingGroup) {
  const row = document.createElement("div");
  row.className = "tab";
  if (t.active) row.classList.add("active");
  if (isTabPinned(t.id)) row.classList.add("pinned");
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
    await handleTabDrop(sourceId, t.id, before, containingGroup);
  });
  const fav = document.createElement("img");
  fav.className = "favicon";
  fav.alt = "";
  fav.referrerPolicy = "no-referrer";
  let faviconAttempts = 0;
  fav.addEventListener("error", () => {
    faviconAttempts++;
    if (faviconAttempts === 1) {
      const fb = fallbackFaviconUrl(t);
      if (fb !== fav.src) { fav.src = fb; return; }
    }
    fav.src = TRANSPARENT_PX;
  });
  fav.src = faviconUrlFor(t);
  const titleSpan = document.createElement("span");
  titleSpan.className = "title";
  titleSpan.textContent = t.title || t.url;
  const hostSpan = document.createElement("span");
  hostSpan.className = "host";
  try { hostSpan.textContent = new URL(t.url).hostname.replace(/^www\./, ""); } catch {}
  const pinBtn = document.createElement("button");
  const pinned = isTabPinned(t.id);
  pinBtn.className = "t-btn pin-btn" + (pinned ? " on" : "");
  pinBtn.title = pinned ? "Unpin tab" : "Pin tab to group";
  pinBtn.textContent = pinned ? "📌" : "📍";
  if (!pinningActive()) pinBtn.classList.add("hidden");
  pinBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await togglePinTab(t.id, containingGroup);
  });
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
  row.appendChild(pinBtn);
  row.appendChild(closeTabBtn);
  row.addEventListener("click", () => browser.tabs.update(t.id, { active: true }));
  return row;
}

function createGroupCard(tabsInGroup, { label, getCurrentLabel, onRename, onBookmark, onClose, pinId, onTogglePin }) {
  const div = document.createElement("div");
  div.className = "group";
  if (pinId != null) div.classList.add("pinned");
  const header = document.createElement("div");
  header.className = "group-header";
  const title = document.createElement("h3");
  title.textContent = label;
  title.contentEditable = "true";
  title.spellcheck = false;
  title.title = "Click to rename";
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); title.blur(); }
    if (e.key === "Escape") { title.textContent = getCurrentLabel(); title.blur(); }
  });
  title.addEventListener("blur", () => {
    const newLabel = title.textContent.trim();
    if (!newLabel) { title.textContent = getCurrentLabel(); return; }
    onRename(newLabel);
  });
  header.appendChild(title);

  const pinBtn = document.createElement("button");
  const groupPinned = pinId != null;
  pinBtn.className = "g-btn pin-btn" + (groupPinned ? " on" : "");
  pinBtn.title = groupPinned ? "Unpin group (allow auto-renaming and reclustering)" : "Pin group (freeze name and members)";
  pinBtn.textContent = groupPinned ? "📌" : "📍";
  if (!pinningActive()) pinBtn.classList.add("hidden");
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onTogglePin();
  });
  header.appendChild(pinBtn);

  const star = document.createElement("button");
  star.className = "g-btn star-btn";
  star.title = "Bookmark group";
  star.textContent = "★";
  if (!options.useBookmark) star.classList.add("hidden");
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    onBookmark(title.textContent.trim() || label);
  });
  header.appendChild(star);

  const close = document.createElement("button");
  close.className = "g-btn";
  close.title = "Close group";
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose();
  });
  header.appendChild(close);

  div.appendChild(header);
  for (const t of tabsInGroup) div.appendChild(createTabRow(t, tabsInGroup));
  return div;
}

function renderGroups(groups) {
  const main = $("#groups");
  main.innerHTML = "";
  main.appendChild(createTopDropZone());
  const frozen = !effectiveAutoApplyNaming();
  if (frozen && appliedSnapshot && appliedSnapshot.length && state?.tabs) {
    renderFrozenView(main);
  } else {
    renderLiveView(main, groups);
  }
  updateCountsDisplay();
}

function createTopDropZone() {
  const bar = document.createElement("div");
  bar.className = "top-drop-zone";
  bar.title = "Drop here to move to the start of the strip";
  bar.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    bar.classList.add("over");
  });
  bar.addEventListener("dragleave", () => bar.classList.remove("over"));
  bar.addEventListener("drop", async (e) => {
    e.preventDefault();
    bar.classList.remove("over");
    const sourceId = +e.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    await moveTabToStart(sourceId);
  });
  return bar;
}

async function moveTabToStart(sourceId) {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const firstGroupable = tabs
      .filter((t) => !t.pinned)
      .sort((a, b) => a.index - b.index)[0];
    const targetIndex = firstGroupable ? firstGroupable.index : 0;
    log(`drop-to-start: moving tab ${sourceId} to index ${targetIndex}`);
    suppressMoveRefresh++;
    try { await browser.tabs.move(sourceId, { index: targetIndex }); }
    finally { setTimeout(() => { suppressMoveRefresh--; }, 250); }
    status(`moved tab to start (index ${targetIndex})`);
    scheduleRefresh("drag-drop-start");
  } catch (e) {
    console.error("moveTabToStart failed", e);
    status("drop-to-start error: " + (e?.message || e));
  }
}

function renderUngroupedTabs(main, usedIds) {
  const leftover = state.tabs.filter((t) => !usedIds.has(t.id)).sort((a, b) => a.index - b.index);
  if (!leftover.length) return;
  const sep = document.createElement("div");
  sep.className = "ungrouped-separator";
  sep.title = "Ungrouped tabs (not placed in any Firefox group)";
  main.appendChild(sep);
  const wrap = document.createElement("div");
  wrap.className = "group ungrouped";
  for (const t of leftover) wrap.appendChild(createTabRow(t, null));
  main.appendChild(wrap);
}

function renderLiveView(main, groups) {
  const tabById = new Map(state.tabs.map((t) => [t.id, t]));
  const groupByTabId = new Map();
  for (const g of groups) for (const t of g) groupByTabId.set(t.id, g);
  const items = mirrorLayout(state.tabs, groups);
  let looseWrap = null;
  for (const item of items) {
    if (item.type === "loose") {
      if (!looseWrap) {
        looseWrap = document.createElement("div");
        looseWrap.className = "group ungrouped";
        main.appendChild(looseWrap);
      }
      looseWrap.appendChild(createTabRow(tabById.get(item.tabId), null));
      continue;
    }
    looseWrap = null;
    const g = groupByTabId.get(item.tabIds[0]);
    const tabs = item.tabIds.map((id) => tabById.get(id));
    const key = groupKey(g);
    const pid = clusterPinId.get(key);
    const card = createGroupCard(tabs, {
      label: labelFor(g),
      getCurrentLabel: () => labelFor(g),
      onRename: (newLabel) => {
        if (pid != null) renamePinnedGroup(pid, newLabel);
        else customLabels.set(key, newLabel);
      },
      onBookmark: (label) => bookmarkGroup(label, tabs),
      onClose: () => closeGroup(g),
      pinId: pid ?? null,
      onTogglePin: () => toggleGroupPin(g, pid),
    });
    main.appendChild(card);
  }
}

function renderFrozenView(main) {
  const tabById = new Map(state.tabs.map((t) => [t.id, t]));
  const used = new Set();
  const orderedEntries = appliedSnapshot
    .map((entry) => {
      const tabs = entry.tabIds.map((id) => tabById.get(id)).filter(Boolean);
      tabs.sort((a, b) => a.index - b.index);
      return { entry, tabs };
    })
    .filter(({ tabs }) => tabs.length > 0)
    .sort((a, b) => a.tabs[0].index - b.tabs[0].index);
  for (const { entry, tabs } of orderedEntries) {
    tabs.forEach((t) => used.add(t.id));
    const pid = clusterPinId.get(groupKey(tabs));
    const card = createGroupCard(tabs, {
      label: entry.name,
      getCurrentLabel: () => entry.name,
      onRename: (newLabel) => {
        if (pid != null) renamePinnedGroup(pid, newLabel);
        entry.name = newLabel;
        const k = [...entry.tabIds].sort((a, b) => a - b).join(",");
        customLabels.set(k, newLabel);
      },
      onBookmark: (label) => bookmarkGroup(label, tabs),
      onClose: () => closeTabs(tabs.map((t) => t.id)),
      pinId: pid ?? null,
      onTogglePin: () => toggleGroupPin(tabs, pid),
    });
    main.appendChild(card);
  }
  renderUngroupedTabs(main, used);
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

async function closeTabs(ids, { label } = {}) {
  try {
    const snapLabel = label || (ids.length === 1 ? "close-tab" : `close-${ids.length}-tabs`);
    await captureUndoSnapshot(snapLabel, { closingTabIds: ids });
    const captured = lastUndoSnapshot?.closedTabs?.length || 0;
    status(`closing ${ids.length} tab(s); undo available (${captured} captured).`);
    await browser.tabs.remove(ids);
    if (state) {
      const remove = new Set(ids);
      const keep = (arr) => arr.filter((_, i) => !remove.has(state.tabs[i].id));
      const newTabs = state.tabs.filter((t) => !remove.has(t.id));
      const newEmbeddings = keep(state.embeddings);
      const newTexts = keep(state.texts);
      state = { tabs: newTabs, embeddings: newEmbeddings, texts: newTexts, lastGroups: null };
      skipNextAutoApply = true;
      await recluster();
    }
  } catch (e) {
    console.error(e);
    status("close error: " + (e?.message || e));
  }
}

async function closeGroup(groupTabs) {
  await closeTabs(groupTabs.map((t) => t.id), { label: `close-group-${groupTabs.length}` });
}

log("sidebar.js loaded, calling initial refresh");
refreshing = true;
Promise.all([loadOptions(), loadPins()])
  .catch((e) => console.warn("[arctictab] init load failed", e))
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
