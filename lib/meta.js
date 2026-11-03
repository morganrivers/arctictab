import { debugLog } from "./log.js";

// A tab closed, discarded or navigated while its extraction is in flight leaves
// the message unanswered rather than rejecting, so every wait on it has to be
// bounded. An unbounded one wedges refresh forever: its `refreshing` flag never
// clears and every later refresh is queued and dropped, freezing the panel on
// the last clustering it managed to finish.
export const META_TIMEOUT_MS = 4000;

export function isMetaExtractable(url) {
  return !!url && !url.startsWith("about:") && !url.startsWith("chrome:");
}

function settleWithin(start, timeoutMs, fallback) {
  console.assert(timeoutMs > 0, "timeoutMs must be > 0");
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), timeoutMs);
    new Promise((run) => run(start())).then(
      (value) => { clearTimeout(timer); resolve({ value, timedOut: false }); },
      (e) => { clearTimeout(timer); resolve({ value: fallback, timedOut: false, error: e }); },
    );
  });
}

export async function collectMetas(tabs, fetchMeta, { timeoutMs = META_TIMEOUT_MS, onSettled } = {}) {
  console.assert(Array.isArray(tabs), "collectMetas needs an array of tabs");
  console.assert(typeof fetchMeta === "function", "collectMetas needs a fetchMeta function");
  let settled = 0;
  let timedOut = 0;
  const one = async (tab) => {
    if (!isMetaExtractable(tab.url)) return null;
    const r = await settleWithin(() => fetchMeta(tab), timeoutMs, null);
    if (r.timedOut) {
      timedOut++;
      debugLog(`[arctictab][meta] extraction timed out after ${timeoutMs}ms for tab ${tab.id} ${tab.url}`);
    }
    if (r.error) debugLog(`[arctictab][meta] extraction failed for tab ${tab.id} ${tab.url}: ${r.error?.message || r.error}`);
    return r.value;
  };
  const metas = await Promise.all(tabs.map((tab) => one(tab).finally(() => {
    settled++;
    onSettled?.(settled, tabs.length);
  })));
  console.assert(metas.length === tabs.length, "collectMetas must return one entry per tab");
  console.assert(settled === tabs.length, "every tab must settle exactly once");
  if (timedOut) debugLog(`[arctictab][meta] ${timedOut}/${tabs.length} extractions timed out`);
  return metas;
}
