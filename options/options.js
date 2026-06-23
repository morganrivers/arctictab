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
  autoApplyGroups: false,
  autoApplyNaming: true,
  nameStyle: "mixed",
  headSim: 0.22,
  curatedSim: 0.27,
  keywordFrac: 0.34,
  autoGroupAnchors: DEFAULT_AUTO_ANCHORS,
};
const SLIDERS = ["headSim", "curatedSim", "keywordFrac"];
const ANCHOR_INDICES = [1, 2, 3];

const $ = (s) => document.querySelector(s);
const excludePinned = $("#excludePinned");
const groupBySimilarity = $("#groupBySimilarity");
const reorganizeGroups = $("#reorganizeGroups");
const hideApplyGroups = $("#hideApplyGroups");
const hideRearrange = $("#hideRearrange");
const autoApplyGroups = $("#autoApplyGroups");
const autoApplyNaming = $("#autoApplyNaming");
const autoApplyNamingHint = $("#autoApplyNamingDisabledHint");
const hideApplyGroupsHint = $("#hideApplyGroupsDisabledHint");
const nameStyle = $("#nameStyle");
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
  autoApplyGroups.checked = !!v.autoApplyGroups;
  autoApplyNaming.checked = !!v.autoApplyNaming;
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
      autoApplyGroups: autoApplyGroups.checked,
      autoApplyNaming: autoApplyNaming.checked,
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
autoApplyGroups.addEventListener("change", onChangeRefresh);
autoApplyNaming.addEventListener("change", onChangeRefresh);
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
