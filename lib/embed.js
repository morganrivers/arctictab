import { debugLog } from "./log.js";
import { MODEL_IDLE_UNLOAD_MINUTES, OPTIONS_DEFAULTS, watchOption } from "./options.js";

const WORKER_URL = new URL("./embed_worker.js", import.meta.url);
const IDLE_UNLOAD_MS = MODEL_IDLE_UNLOAD_MINUTES * 60 * 1000;

const progressListeners = new Set();

export function onExtractorProgress(fn) {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

function emitProgress(p) {
  for (const fn of progressListeners) {
    try { fn(p); } catch (e) { console.error("[arctictab] progress listener error", e); }
  }
}

// Turns the per-file download events of one load into an overall fraction,
// emitted once per whole percent.
function makeProgressAggregator() {
  const bytesByFile = new Map();
  let lastBucket = -1;
  return (p) => {
    if (p?.status !== "progress" || !(p.total > 0)) { emitProgress(p); return; }
    bytesByFile.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0, total = 0;
    for (const v of bytesByFile.values()) { loaded += v.loaded; total += v.total; }
    const overall = total > 0 ? Math.min(1, loaded / total) : 0;
    const bucket = Math.round(overall * 100);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    emitProgress({ ...p, overall });
    if (overall >= 1) emitProgress({ status: "initializing" });
  };
}

// One running copy of the model, in its own worker (lib/embed_worker.js).
class ModelWorker {
  constructor() {
    this.worker = new Worker(WORKER_URL, { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    const onProgress = makeProgressAggregator();
    this.ready = new Promise((resolve, reject) => { this.readyCallbacks = { resolve, reject }; });
    this.worker.onmessage = ({ data: msg }) => {
      if (msg.type === "progress") onProgress(msg.progress);
      else if (msg.type === "ready") this.readyCallbacks.resolve();
      else if (msg.type === "result") this.settle(msg.id, (p) => p.resolve(msg));
      else if (msg.type === "error") this.fail(new Error(`embed worker: ${msg.message}`), msg.id);
      else console.error("[arctictab] embed: unknown worker message", msg);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.fail(new Error(`embed worker crashed: ${e.message || "unknown error"}`), null);
    };
    this.worker.postMessage({ type: "load" });
  }

  get busy() { return this.pending.size > 0; }

  settle(id, fn) {
    const p = this.pending.get(id);
    console.assert(p, `embed worker answered unknown request ${id}`);
    if (!p) return;
    this.pending.delete(id);
    fn(p);
  }

  // A failure tied to one request rejects only that request; any other failure
  // means the model is unusable, so loading and every waiting request fail.
  fail(error, id) {
    if (id !== null && id !== undefined) { this.settle(id, (p) => p.reject(error)); return; }
    this.readyCallbacks.reject(error);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  // Registered before the model is ready, so the request counts as busy and a
  // failed load or a stop rejects it instead of leaving it unanswered.
  embed(texts) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ready.then(
      () => this.worker.postMessage({ type: "embed", id, texts }),
      (e) => { if (this.pending.has(id)) this.settle(id, (p) => p.reject(e)); },
    );
    return result;
  }

  terminate() {
    this.worker.terminate();
    this.fail(new Error("embed worker stopped"), null);
  }
}

let model = null;
let idleTimer = null;
let unloadWhenIdle = OPTIONS_DEFAULTS.unloadModelWhenIdle;

watchOption("unloadModelWhenIdle", (value) => {
  unloadWhenIdle = !!value;
  debugLog(`[arctictab] embed: unload model when idle = ${unloadWhenIdle}`);
  scheduleIdleUnload();
}).catch((e) => console.error("[arctictab] embed: cannot read unloadModelWhenIdle; using the default", e));

function runningModel() {
  if (!model) {
    debugLog("[arctictab] embed: starting model worker (wasm/q8)");
    const started = new ModelWorker();
    started.ready.then(
      () => { emitProgress({ status: "ready" }); debugLog("[arctictab] embed: ready (wasm)"); },
      (e) => {
        console.error("[arctictab] embed: model failed to load", e);
        if (model === started) { model = null; started.terminate(); }
      },
    );
    model = started;
  }
  return model;
}

function scheduleIdleUnload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (unloadWhenIdle && model) idleTimer = setTimeout(unloadIdleModel, IDLE_UNLOAD_MS);
}

function unloadIdleModel() {
  idleTimer = null;
  if (!model) return;
  if (model.busy) { scheduleIdleUnload(); return; }
  model.terminate();
  model = null;
  debugLog("[arctictab] embed: stopped idle model worker; its memory is freed");
}

export function getExtractor() {
  const m = runningModel();
  scheduleIdleUnload();
  return m.ready;
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
  const m = runningModel();
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    const { data, dims } = await m.embed(texts);
    const dim = dims[dims.length - 1];
    console.assert(data.length === texts.length * dim, "embedding output size must match the batch");
    const out = [];
    for (let i = 0; i < texts.length; i++) out.push(data.slice(i * dim, (i + 1) * dim));
    return out;
  } finally {
    if (!m.busy) scheduleIdleUnload();
  }
}
