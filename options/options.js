import { initTheme } from "../lib/theme.js";
import { OPTIONS_KEY, OPTIONS_DEFAULTS as DEFAULTS } from "../lib/options.js";

initTheme();

const SLIDERS = ["headSim", "curatedSim", "keywordFrac"];

const $ = (s) => document.querySelector(s);
const excludePinned = $("#excludePinned");
const reorganizeGroups = $("#reorganizeGroups");
const groupIdenticalTogether = $("#groupIdenticalTogether");
const identicalOwnGroup = $("#identicalOwnGroup");
const identicalOwnGroupHint = $("#identicalOwnGroupHint");
const hideApplyGroups = $("#hideApplyGroups");
const hideRearrange = $("#hideRearrange");
const hideGroupCount = $("#hideGroupCount");
const hideTabCount = $("#hideTabCount");
const hideStatus = $("#hideStatus");
const autoApplyGroups = $("#autoApplyGroups");
const autoApplyNaming = $("#autoApplyNaming");
const autoApplyNamingHint = $("#autoApplyNamingDisabledHint");
const hideApplyGroupsHint = $("#hideApplyGroupsDisabledHint");
const hideRearrangeHint = $("#hideRearrangeDisabledHint");
const ctrlTabNotice = $("#ctrlTabNotice");
const nameStyle = $("#nameStyle");
const usePinning = $("#usePinning");
const useBookmark = $("#useBookmark");
const autoPinTabOnDrag = $("#autoPinTabOnDrag");
const autoPinGroupOnDrag = $("#autoPinGroupOnDrag");
const showSearchBar = $("#showSearchBar");
const showCopyState = $("#showCopyState");
const hideTabTitle = $("#hideTabTitle");
const hideTabHost = $("#hideTabHost");
const hideControlGroupSize = $("#hideControlGroupSize");
const debugLogging = $("#debugLogging");
const autoPinTabHint = $("#autoPinTabHint");
const autoPinGroupHint = $("#autoPinGroupHint");
const status = $("#status");
const groupingRulesList = $("#groupingRulesList");
const addGroupingRule = $("#addGroupingRule");
let groupingRules = [];
const sliders = Object.fromEntries(SLIDERS.map((k) => [k, $("#" + k)]));

function showSlider(k) {
  $("#" + k + "-val").textContent = (+sliders[k].value).toFixed(2);
}

function updateDisabledStates() {
  const namingForced = autoApplyGroups.checked;
  console.assert(ctrlTabNotice, "the Ctrl+Tab notice must exist in the options markup");
  ctrlTabNotice.classList.toggle("show", namingForced);

  autoApplyNaming.disabled = namingForced;
  autoApplyNaming.closest("label").classList.toggle("disabled", namingForced);
  autoApplyNamingHint.textContent = "(uncheck \"Auto-organize tabs\" to use this setting)";
  autoApplyNamingHint.classList.toggle("show", namingForced);

  hideRearrange.disabled = namingForced;
  hideRearrange.closest("label").classList.toggle("disabled", namingForced);
  hideRearrangeHint.textContent = "(the button is already hidden by \"Auto-organize tabs\")";
  hideRearrangeHint.classList.toggle("show", namingForced);

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

  const identicalOff = !groupIdenticalTogether.checked;
  identicalOwnGroup.disabled = identicalOff;
  identicalOwnGroup.closest("label").classList.toggle("disabled", identicalOff);
  identicalOwnGroupHint.classList.toggle("show", identicalOff);

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

function renderGroupingRules() {
  groupingRulesList.innerHTML = "";
  groupingRules.forEach((rule, i) => {
    const row = document.createElement("div");
    row.className = "grouping-rule-row";

    const field = document.createElement("select");
    field.innerHTML = `<option value="domain">Domain contains</option><option value="title">Title contains</option>`;
    field.value = rule.field === "title" ? "title" : "domain";
    field.addEventListener("change", () => { groupingRules[i].field = field.value; save(); });

    const pattern = document.createElement("input");
    pattern.type = "text";
    pattern.placeholder = "mail|gmail|outlook";
    pattern.autocomplete = "off";
    pattern.spellcheck = false;
    pattern.value = rule.pattern || "";
    pattern.addEventListener("change", () => { groupingRules[i].pattern = pattern.value.trim(); save(); });

    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Group name (e.g. Mail)";
    name.autocomplete = "off";
    name.spellcheck = false;
    name.value = rule.name || "";
    name.addEventListener("change", () => { groupingRules[i].name = name.value.trim(); save(); });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", "Remove rule");
    remove.addEventListener("click", () => {
      groupingRules.splice(i, 1);
      renderGroupingRules();
      save();
    });

    row.append(field, pattern, name, remove);
    groupingRulesList.appendChild(row);
  });
}

addGroupingRule.addEventListener("click", () => {
  groupingRules.push({ field: "domain", pattern: "", name: "" });
  renderGroupingRules();
});

async function load() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  const v = { ...DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  excludePinned.checked = !!v.excludePinned;
  reorganizeGroups.checked = !!v.reorganizeGroups;
  groupIdenticalTogether.checked = !!v.groupIdenticalTogether;
  identicalOwnGroup.checked = !!v.identicalOwnGroup;
  hideApplyGroups.checked = !!v.hideApplyGroups;
  hideRearrange.checked = !!v.hideRearrange;
  hideGroupCount.checked = !!v.hideGroupCount;
  hideTabCount.checked = !!v.hideTabCount;
  hideStatus.checked = !!v.hideStatus;
  autoApplyGroups.checked = !!v.autoApplyGroups;
  autoApplyNaming.checked = !!v.autoApplyNaming;
  usePinning.checked = !!v.usePinning;
  useBookmark.checked = !!v.useBookmark;
  autoPinTabOnDrag.checked = !!v.autoPinTabOnDrag;
  autoPinGroupOnDrag.checked = !!v.autoPinGroupOnDrag;
  showSearchBar.checked = !!v.showSearchBar;
  showCopyState.checked = !!v.showCopyState;
  hideTabTitle.checked = !!v.hideTabTitle;
  hideTabHost.checked = !!v.hideTabHost;
  hideControlGroupSize.checked = !!v.hideControlGroupSize;
  debugLogging.checked = !!v.debugLogging;
  nameStyle.value = v.nameStyle;
  for (const k of SLIDERS) { sliders[k].value = String(v[k]); showSlider(k); }
  groupingRules = (v.groupingRules || []).map((r) => ({ field: r.field === "title" ? "title" : "domain", pattern: r.pattern || "", name: r.name || "" }));
  renderGroupingRules();
  updateDisabledStates();
}

async function save() {
  await browser.storage.local.set({
    [OPTIONS_KEY]: {
      excludePinned: excludePinned.checked,
      reorganizeGroups: reorganizeGroups.checked,
      groupIdenticalTogether: groupIdenticalTogether.checked,
      identicalOwnGroup: identicalOwnGroup.checked,
      hideApplyGroups: hideApplyGroups.checked,
      hideRearrange: hideRearrange.checked,
      hideGroupCount: hideGroupCount.checked,
      hideTabCount: hideTabCount.checked,
      hideStatus: hideStatus.checked,
      autoApplyGroups: autoApplyGroups.checked,
      autoApplyNaming: autoApplyNaming.checked,
      usePinning: usePinning.checked,
      useBookmark: useBookmark.checked,
      autoPinTabOnDrag: autoPinTabOnDrag.checked,
      autoPinGroupOnDrag: autoPinGroupOnDrag.checked,
      showSearchBar: showSearchBar.checked,
      showCopyState: showCopyState.checked,
      hideTabTitle: hideTabTitle.checked,
      hideTabHost: hideTabHost.checked,
      hideControlGroupSize: hideControlGroupSize.checked,
      debugLogging: debugLogging.checked,
      nameStyle: nameStyle.value,
      headSim: +sliders.headSim.value,
      curatedSim: +sliders.curatedSim.value,
      keywordFrac: +sliders.keywordFrac.value,
      groupingRules: groupingRules.filter((r) => r.pattern),
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
reorganizeGroups.addEventListener("change", save);
groupIdenticalTogether.addEventListener("change", save);
identicalOwnGroup.addEventListener("change", save);
hideApplyGroups.addEventListener("change", save);
hideRearrange.addEventListener("change", save);
hideGroupCount.addEventListener("change", save);
hideTabCount.addEventListener("change", save);
hideStatus.addEventListener("change", save);
autoApplyGroups.addEventListener("change", onChangeRefresh);
autoApplyNaming.addEventListener("change", onChangeRefresh);
usePinning.addEventListener("change", onChangeRefresh);
useBookmark.addEventListener("change", save);
autoPinTabOnDrag.addEventListener("change", save);
autoPinGroupOnDrag.addEventListener("change", save);
showSearchBar.addEventListener("change", save);
showCopyState.addEventListener("change", save);
hideTabTitle.addEventListener("change", save);
hideTabHost.addEventListener("change", save);
hideControlGroupSize.addEventListener("change", save);
debugLogging.addEventListener("change", save);
nameStyle.addEventListener("change", save);
for (const k of SLIDERS) {
  sliders[k].addEventListener("input", () => showSlider(k));
  sliders[k].addEventListener("change", save);
}

function bindShortcutEditor({ command, defaultShortcut, input, saveBtn, resetBtn, status }) {
  const field = $(input);
  const statusEl = $(status);
  console.assert(field && statusEl, `shortcut editor needs ${input} and ${status}`);

  async function loadShortcut() {
    try {
      const cmds = await browser.commands.getAll();
      field.value = cmds.find((c) => c.name === command)?.shortcut || "";
    } catch (e) {
      statusEl.textContent = "Shortcut API unavailable: " + (e?.message || e);
    }
  }

  async function saveShortcut() {
    const shortcut = field.value.trim();
    try {
      await browser.commands.update({ name: command, shortcut });
      statusEl.textContent = shortcut ? `Shortcut set to ${shortcut}.` : "Shortcut cleared.";
    } catch (e) {
      statusEl.textContent = "Invalid shortcut: " + (e?.message || e);
    }
  }

  async function resetShortcut() {
    try {
      await browser.commands.reset(command);
      await loadShortcut();
      statusEl.textContent = `Shortcut reset to ${defaultShortcut}.`;
    } catch (e) {
      statusEl.textContent = "Reset failed: " + (e?.message || e);
    }
  }

  $(saveBtn).addEventListener("click", saveShortcut);
  $(resetBtn).addEventListener("click", resetShortcut);
  loadShortcut();
}

bindShortcutEditor({
  command: "_execute_action",
  defaultShortcut: "Ctrl+Shift+F",
  input: "#searchShortcut",
  saveBtn: "#searchShortcutSave",
  resetBtn: "#searchShortcutReset",
  status: "#shortcutStatus",
});

bindShortcutEditor({
  command: "close-group",
  defaultShortcut: "Alt+W",
  input: "#closeGroupShortcut",
  saveBtn: "#closeGroupShortcutSave",
  resetBtn: "#closeGroupShortcutReset",
  status: "#closeGroupShortcutStatus",
});

load().catch((e) => {
  console.error(e);
  status.textContent = "Load error: " + (e?.message || e);
});
