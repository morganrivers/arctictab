import { debugLog } from "./log.js";
import { OPTIONS_DEFAULTS, watchOption } from "./options.js";

const WORKER_URL = new URL("./embed_worker.js", import.meta.url);
const WORKER_NAME = "arctictab-model";

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

// The page side of the one shared model worker (lib/embed_worker.js, served by lib/modelhost.js).
class ModelClient {
  constructor() {
    this.port = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
    this.unloadWhenIdle = OPTIONS_DEFAULTS.unloadModelWhenIdle;
    this.onProgress = makeProgressAggregator();
  }

  connection() {
    if (!this.port) {
      debugLog("[arctictab] embed: connecting to the shared model worker");
      const worker = new SharedWorker(WORKER_URL, { type: "module", name: WORKER_NAME });
      worker.onerror = (e) => {
        e.preventDefault?.();
        this.failAll(new Error(`model worker failed: ${e.message || "unknown error"}`));
      };
      this.port = worker.port;
      this.port.onmessage = ({ data }) => this.handle(data);
      this.port.start();
      this.onProgress = makeProgressAggregator();
      this.port.postMessage({ type: "config", unloadWhenIdle: this.unloadWhenIdle });
    }
    return this.port;
  }

  setUnloadWhenIdle(value) {
    this.unloadWhenIdle = value;
    this.port?.postMessage({ type: "config", unloadWhenIdle: value });
  }

  // Resolves once the shared worker has the model loaded.
  loaded() {
    if (!this.ready) {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      this.ready = { promise, resolve, reject, answered: false };
      this.connection().postMessage({ type: "load" });
    }
    return this.ready.promise;
  }

  embed(texts) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { texts, resolve, reject }));
    this.connection().postMessage({ type: "embed", id, texts });
    return result;
  }

  handle(msg) {
    if (msg.type === "progress") this.onProgress(msg.progress);
    else if (msg.type === "ready") this.onReady();
    else if (msg.type === "loadError") this.onLoadError(msg.message);
    else if (msg.type === "result") this.settle(msg.id, (p) => p.resolve(msg));
    else if (msg.type === "error") this.settle(msg.id, (p) => p.reject(new Error(`embed worker: ${msg.message}`)));
    else if (msg.type === "closing") this.onClosing();
    else console.error("[arctictab] embed: unknown worker message", msg);
  }

  onReady() {
    if (this.ready) { this.ready.answered = true; this.ready.resolve(); }
    emitProgress({ status: "ready" });
    debugLog("[arctictab] embed: ready (wasm)");
  }

  onLoadError(message) {
    const error = new Error(`model failed to load: ${message}`);
    console.error("[arctictab] embed:", error);
    this.ready?.reject(error);
    this.ready = null;
  }

  settle(id, fn) {
    const p = this.pending.get(id);
    console.assert(p, `model worker answered unknown request ${id}`);
    if (!p) return;
    this.pending.delete(id);
    fn(p);
  }

  // The worker stopped while idle. Requests it had not answered were dropped
  // on its side, so they go again to a new worker.
  onClosing() {
    debugLog("[arctictab] embed: shared model worker stopped while idle; its memory is freed");
    this.port = null;
    const waiting = this.ready && !this.ready.answered;
    if (!waiting) this.ready = null;
    if (waiting) this.connection().postMessage({ type: "load" });
    for (const [id, p] of this.pending) this.connection().postMessage({ type: "embed", id, texts: p.texts });
  }

  failAll(error) {
    console.error("[arctictab] embed:", error);
    this.port = null;
    this.ready?.reject(error);
    this.ready = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }
}

const model = new ModelClient();

watchOption("unloadModelWhenIdle", (value) => {
  debugLog(`[arctictab] embed: unload model when idle = ${!!value}`);
  model.setUnloadWhenIdle(!!value);
}).catch((e) => console.error("[arctictab] embed: cannot read unloadModelWhenIdle; using the default", e));

export function getExtractor() {
  return model.loaded();
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
  const { data, dims } = await model.embed(texts);
  const dim = dims[dims.length - 1];
  console.assert(data.length === texts.length * dim, "embedding output size must match the batch");
  const out = [];
  for (let i = 0; i < texts.length; i++) out.push(data.slice(i * dim, (i + 1) * dim));
  return out;
}
