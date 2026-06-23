import { pipeline, env } from "../vendor/transformers/transformers.min.js";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = browser.runtime.getURL("vendor/transformers/models/");
env.backends.onnx.wasm.wasmPaths = browser.runtime.getURL("vendor/transformers/wasm/");
env.backends.onnx.wasm.numThreads = 1;

const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";
const IDLE_UNLOAD_MS = 15 * 60 * 1000;

let extractorPromise = null;
let idleTimer = null;
let progressListeners = new Set();

export function onExtractorProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function emitProgress(p) {
  for (const fn of progressListeners) {
    try { fn(p); } catch (e) { console.error("[arctictab] progress listener error", e); }
  }
}

async function loadExtractor() {
  console.log("[arctictab] embed: loading bundled model (wasm/q8)");
  const ext = await pipeline("feature-extraction", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (p) => {
      console.log("[arctictab] embed progress", p);
      emitProgress(p);
    },
  });
  console.log("[arctictab] embed: ready (wasm)");
  return ext;
}

function scheduleIdleUnload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(unloadExtractor, IDLE_UNLOAD_MS);
}

async function unloadExtractor() {
  idleTimer = null;
  const p = extractorPromise;
  if (!p) return;
  extractorPromise = null;
  try {
    const ext = await p;
    if (ext?.dispose) await ext.dispose();
  } catch (e) {
    console.warn("[arctictab] embed: dispose error", e);
  }
  console.log("[arctictab] embed: unloaded idle extractor");
}

export function getExtractor() {
  if (!extractorPromise) extractorPromise = loadExtractor();
  scheduleIdleUnload();
  return extractorPromise;
}

function cleanTitle(title) {
  return title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[\|·—–-]\s*[^|·—–-]+$/u, "")
    .trim();
}

const SEARCH_ENGINES = {
  "google.com": { path: "/search", param: "q" },
  "www.google.com": { path: "/search", param: "q" },
  "duckduckgo.com": { path: "/", param: "q" },
  "www.bing.com": { path: "/search", param: "q" },
  "bing.com": { path: "/search", param: "q" },
};

function searchQueryOf(url) {
  try {
    const u = new URL(url);
    const eng = SEARCH_ENGINES[u.hostname];
    if (!eng) return null;
    if (!u.pathname.startsWith(eng.path)) return null;
    const q = u.searchParams.get(eng.param);
    return q ? q.trim() : null;
  } catch {
    return null;
  }
}

export function buildText(tab, meta) {
  let host = "";
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {}
  const query = searchQueryOf(tab.url);
  if (query) {
    return (query + " " + query + " search " + host).slice(0, 800);
  }
  const title = cleanTitle(tab.title || "");
  const metaText = meta?.text || "";
  return [title, host, metaText].filter(Boolean).join(" ").slice(0, 800);
}

export async function embedBatch(texts) {
  console.assert(Array.isArray(texts) && texts.length > 0, "texts must be non-empty array");
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const flat = output.data;
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(new Float32Array(flat.slice(i * dim, (i + 1) * dim)));
  }
  return out;
}
