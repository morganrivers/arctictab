const OPTIONS_KEY = "arctictab:options";
const DEFAULTS = { excludePinned: true, rearrange: false, nameStyle: "mixed" };

const $ = (s) => document.querySelector(s);
const excludePinned = $("#excludePinned");
const rearrange = $("#rearrange");
const nameStyle = $("#nameStyle");
const status = $("#status");

async function load() {
  const r = await browser.storage.local.get(OPTIONS_KEY);
  const v = { ...DEFAULTS, ...(r[OPTIONS_KEY] || {}) };
  excludePinned.checked = !!v.excludePinned;
  rearrange.checked = !!v.rearrange;
  nameStyle.value = v.nameStyle;
}

async function save() {
  await browser.storage.local.set({
    [OPTIONS_KEY]: {
      excludePinned: excludePinned.checked,
      rearrange: rearrange.checked,
      nameStyle: nameStyle.value,
    },
  });
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1200);
}

excludePinned.addEventListener("change", save);
rearrange.addEventListener("change", save);
nameStyle.addEventListener("change", save);

load().catch((e) => {
  console.error(e);
  status.textContent = "Load error: " + (e?.message || e);
});
