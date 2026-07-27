const OPTIONS_KEY = "arctictab:options";
const DEBUG_KEY = "debugLogging";

let enabled = false;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(enabled); } catch (e) { console.warn("[arctictab] log listener error", e); }
  }
}

async function init() {
  try {
    const r = await browser.storage.local.get(OPTIONS_KEY);
    const opts = r[OPTIONS_KEY] || {};
    const next = !!opts[DEBUG_KEY];
    if (next !== enabled) { enabled = next; notify(); }
  } catch (e) {
    console.warn("[arctictab] log init failed", e);
  }
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[OPTIONS_KEY]) return;
      const nv = changes[OPTIONS_KEY].newValue || {};
      const next = !!nv[DEBUG_KEY];
      if (next !== enabled) { enabled = next; notify(); }
    });
  } catch (e) {
    console.warn("[arctictab] log subscribe failed", e);
  }
}

init();

export function isDebugEnabled() { return enabled; }

export function onDebugChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function debugLog(...args) {
  if (!enabled) return;
  console.log(...args);
}
