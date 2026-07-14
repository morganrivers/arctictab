import { initTheme } from "../lib/theme.js";

initTheme();

const OPTIONS_KEY = "arctictab:options";
const DEFAULT_AUTO_ANCHORS = [
  { tabs: 10, groups: 3 },
  { tabs: 15, groups: 4 },
  { tabs: 25, groups: 5 },
];
const DEFAULTS = {
  excludePinned: true,
  groupBySimilarity: false,
  reorganizeGroups: false,
  hideApplyGroups: false,
  hideRearrange: false,
  hideGroupCount: false,
  hideTabCount: false,
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
const SLIDERS = ["headSim", "curatedSim", "keywordFrac"];
const ANCHOR_INDICES = [1, 2, 3];

const $ = (s) => document.querySelector(s);
const excludePinned = $("#excludePinned");
const groupBySimilarity = $("#groupBySimilarity");
const reorganizeGroups = $("#reorganizeGroups");
const hideApplyGroups = $("#hideApplyGroups");
const hideRearrange = $("#hideRearrange");
const hideGroupCount = $("#hideGroupCount");
const hideTabCount = $("#hideTabCount");
const autoApplyGroups = $("#autoApplyGroups");
const autoApplyNaming = $("#autoApplyNaming");
const autoApplyNamingHint = $("#autoApplyNamingDisabledHint");
const hideApplyGroupsHint = $("#hideApplyGroupsDisabledHint");
const nameStyle = $("#nameStyle");
const usePinning = $("#usePinning");
const useBookmark = $("#useBookmark");
const autoPinTabOnDrag = $("#autoPinTabOnDrag");
const autoPinGroupOnDrag = $("#autoPinGroupOnDrag");
const autoPinTabHint = $("#autoPinTabHint");
const autoPinGroupHint = $("#autoPinGroupHint");
const status = $("#status");
const sliders = Object.fromEntries(SLIDERS.map((k) => [k, $("#" + k)]));
const anchorInputs = ANCHOR_INDICES.map((i) => ({
  tabs: $("#anchorTabs" + i),
  groups: $("#anchorGroups" + i),
}));

function showSlider(k) {
  $("#" + k + "-val").textContent = (+sliders[k].value).toFixed(2);
}

function updateDisabledStates() {
  const namingForced = autoApplyGroups.checked;
  autoApplyNaming.disabled = namingForced;
  autoApplyNaming.closest("label").classList.toggle("disabled", namingForced);
  autoApplyNamingHint.textContent = "(uncheck \"Auto-organize tabs\" to use this setting)";
  autoApplyNamingHint.classList.toggle("show", namingForced);

  const effectiveAutoApplyNaming = namingForced || autoApplyNaming.checked;
  hideApplyGroups.disabled = effectiveAutoApplyNaming;
  hideApplyGroups.closest("label").classList.toggle("disabled", effectiveAutoApplyNaming);
  if (effectiveAutoApplyNaming) {
    const which = namingForced ? "Auto-organize tabs" : "Auto-apply groups and group names";
    hideApplyGroupsHint.textContent = `(uncheck "${which}" to use this setting)`;
    hideApplyGroupsHint.classList.add("show");
  } else {
    hideApplyGroupsHint.classList.remove("show");
  }

  const pinningOff = !usePinning.checked;
  for (const [chk, hint] of [
    [autoPinTabOnDrag, autoPinTabHint],
    [autoPinGroupOnDrag, autoPinGroupHint],
  ]) {
    chk.disabled = pinningOff;
    chk.closest("label").classList.toggle("disabled", pinningOff);
    if (pinningOff) { hint.textContent = "(enable \"Use pinning feature\" to use this setting)"; hint.classList.add("show"); }
    else hint.classList.remove("show");
  }
}

function readAnchors() {
  return anchorInputs.map((a) => ({
    tabs: Math.max(1, Math.round(+a.tabs.value) || 0),
    groups: Math.max(1, Math.round(+a.groups.value) || 0),
  })).filter((a) => a.tabs > 0 && a.groups > 0);
}

function writeAnchors(anchors) {
  const list = (anchors && anchors.length ? anchors : DEFAULT_AUTO_ANCHORS);
  for (let i = 0; i < anchorInputs.length; i++) {
    const a = list[i] || DEFAULT_AUTO_ANCHORS[i];
    anchorInputs[i].tabs.value = String(a.tabs);
    anchorInputs[i].groups.value = String(a.groups);
  }
}

async function load() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  const v = { ...DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  excludePinned.checked = !!v.excludePinned;
  groupBySimilarity.checked = !!v.groupBySimilarity;
  reorganizeGroups.checked = !!v.reorganizeGroups;
  hideApplyGroups.checked = !!v.hideApplyGroups;
  hideRearrange.checked = !!v.hideRearrange;
  hideGroupCount.checked = !!v.hideGroupCount;
  hideTabCount.checked = !!v.hideTabCount;
  autoApplyGroups.checked = !!v.autoApplyGroups;
  autoApplyNaming.checked = !!v.autoApplyNaming;
  usePinning.checked = !!v.usePinning;
  useBookmark.checked = !!v.useBookmark;
  autoPinTabOnDrag.checked = !!v.autoPinTabOnDrag;
  autoPinGroupOnDrag.checked = !!v.autoPinGroupOnDrag;
  nameStyle.value = v.nameStyle;
  for (const k of SLIDERS) { sliders[k].value = String(v[k]); showSlider(k); }
  writeAnchors(v.autoGroupAnchors);
  updateDisabledStates();
}

async function save() {
  await browser.storage.local.set({
    [OPTIONS_KEY]: {
      excludePinned: excludePinned.checked,
      groupBySimilarity: groupBySimilarity.checked,
      reorganizeGroups: reorganizeGroups.checked,
      hideApplyGroups: hideApplyGroups.checked,
      hideRearrange: hideRearrange.checked,
      hideGroupCount: hideGroupCount.checked,
      hideTabCount: hideTabCount.checked,
      autoApplyGroups: autoApplyGroups.checked,
      autoApplyNaming: autoApplyNaming.checked,
      usePinning: usePinning.checked,
      useBookmark: useBookmark.checked,
      autoPinTabOnDrag: autoPinTabOnDrag.checked,
      autoPinGroupOnDrag: autoPinGroupOnDrag.checked,
      nameStyle: nameStyle.value,
      headSim: +sliders.headSim.value,
      curatedSim: +sliders.curatedSim.value,
      keywordFrac: +sliders.keywordFrac.value,
      autoGroupAnchors: readAnchors(),
    },
  });
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1200);
}

function onChangeRefresh() {
  updateDisabledStates();
  save();
}

excludePinned.addEventListener("change", save);
groupBySimilarity.addEventListener("change", save);
reorganizeGroups.addEventListener("change", save);
hideApplyGroups.addEventListener("change", save);
hideRearrange.addEventListener("change", save);
hideGroupCount.addEventListener("change", save);
hideTabCount.addEventListener("change", save);
autoApplyGroups.addEventListener("change", onChangeRefresh);
autoApplyNaming.addEventListener("change", onChangeRefresh);
usePinning.addEventListener("change", onChangeRefresh);
useBookmark.addEventListener("change", save);
autoPinTabOnDrag.addEventListener("change", save);
autoPinGroupOnDrag.addEventListener("change", save);
nameStyle.addEventListener("change", save);
for (const k of SLIDERS) {
  sliders[k].addEventListener("input", () => showSlider(k));
  sliders[k].addEventListener("change", save);
}
for (const a of anchorInputs) {
  a.tabs.addEventListener("change", save);
  a.groups.addEventListener("change", save);
}

load().catch((e) => {
  console.error(e);
  status.textContent = "Load error: " + (e?.message || e);
});
