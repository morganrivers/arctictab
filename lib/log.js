import { watchOption } from "./options.js";

let enabled = false;
let initialized = false;
const listeners = new Set();

function notify() {
  for (const fn of listeners) {
    try { fn(enabled); } catch (e) { console.warn("[arctictab] log listener error", e); }
  }
}

const ready = watchOption("debugLogging", (value) => {
  const next = !!value;
  if (next !== enabled) { enabled = next; notify(); }
})
  .catch((e) => console.warn("[arctictab] log init failed", e))
  .then(() => { initialized = true; });

export function isDebugEnabled() { return enabled; }

export function whenDebugReady(fn) {
  console.assert(typeof fn === "function", "whenDebugReady needs a callback");
  if (initialized) fn();
  else ready.then(fn);
}

export function onDebugChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function debugLog(...args) {
  whenDebugReady(() => { if (enabled) console.log(...args); });
}
