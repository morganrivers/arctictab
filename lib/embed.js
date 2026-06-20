import { pipeline, env } from "../vendor/transformers/transformers.min.js";

env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";

let extractorPromise = null;
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
  const tryDevice = async (device) => {
    console.log("[arctictab] embed: loading model on", device);
    return pipeline("feature-extraction", MODEL_ID, {
      device,
      dtype: device === "webgpu" ? "fp16" : "q8",
      progress_callback: (p) => {
        console.log("[arctictab] embed progress", p);
        emitProgress(p);
      },
    });
  };
  try {
    const ext = await tryDevice("webgpu");
    console.log("[arctictab] embed: ready (webgpu)");
    return ext;
  } catch (e) {
    console.warn("[arctictab] WebGPU unavailable, falling back to WASM:", e);
    const ext = await tryDevice("wasm");
    console.log("[arctictab] embed: ready (wasm)");
    return ext;
  }
}

export function getExtractor() {
  if (!extractorPromise) extractorPromise = loadExtractor();
  return extractorPromise;
}

function cleanTitle(title) {
  return title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[\|·—–-]\s*[^|·—–-]+$/u, "")
    .trim();
}

export function buildText(tab, meta) {
  const title = cleanTitle(tab.title || "");
  let host = "";
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {}
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
