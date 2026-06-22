const OPTIONS_KEY = "arctictab:options";
const DEFAULTS = {
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
const SLIDERS = ["headSim", "curatedSim", "keywordFrac"];

const $ = (s) => document.querySelector(s);
const excludePinned = $("#excludePinned");
const rearrange = $("#rearrange");
const hideApplyGroups = $("#hideApplyGroups");
const hideRearrange = $("#hideRearrange");
const autoApplyGroups = $("#autoApplyGroups");
const nameStyle = $("#nameStyle");
const status = $("#status");
const sliders = Object.fromEntries(SLIDERS.map((k) => [k, $("#" + k)]));

function showSlider(k) {
  $("#" + k + "-val").textContent = (+sliders[k].value).toFixed(2);
}

async function load() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  const v = { ...DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  excludePinned.checked = !!v.excludePinned;
  rearrange.checked = !!v.rearrange;
  hideApplyGroups.checked = !!v.hideApplyGroups;
  hideRearrange.checked = !!v.hideRearrange;
  autoApplyGroups.checked = !!v.autoApplyGroups;
  nameStyle.value = v.nameStyle;
  for (const k of SLIDERS) { sliders[k].value = String(v[k]); showSlider(k); }
}

async function save() {
  await browser.storage.local.set({
    [OPTIONS_KEY]: {
      excludePinned: excludePinned.checked,
      rearrange: rearrange.checked,
      hideApplyGroups: hideApplyGroups.checked,
      hideRearrange: hideRearrange.checked,
      autoApplyGroups: autoApplyGroups.checked,
      nameStyle: nameStyle.value,
      headSim: +sliders.headSim.value,
      curatedSim: +sliders.curatedSim.value,
      keywordFrac: +sliders.keywordFrac.value,
    },
  });
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1200);
}

excludePinned.addEventListener("change", save);
rearrange.addEventListener("change", save);
hideApplyGroups.addEventListener("change", save);
hideRearrange.addEventListener("change", save);
autoApplyGroups.addEventListener("change", save);
nameStyle.addEventListener("change", save);
for (const k of SLIDERS) {
  sliders[k].addEventListener("input", () => showSlider(k));
  sliders[k].addEventListener("change", save);
}

load().catch((e) => {
  console.error(e);
  status.textContent = "Load error: " + (e?.message || e);
});
