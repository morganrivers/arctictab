// Runs the embedding model. lib/embed.js owns this worker and terminates it to
// free the model: WebAssembly memory never shrinks, and dispose() leaves both
// the runtime's heap and its compiled code in place. Only ending the worker
// returns them.
import { pipeline, env } from "../vendor/transformers/transformers.js";

const VENDOR_URL = new URL("../vendor/transformers/", import.meta.url).href;
const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = VENDOR_URL + "models/";
env.backends.onnx.wasm.wasmPaths = VENDOR_URL + "wasm/";
env.backends.onnx.wasm.numThreads = 1;
// This worker already keeps inference off the page's thread.
env.backends.onnx.wasm.proxy = false;

let extractorPromise = null;

function loadExtractor() {
  extractorPromise ??= pipeline("feature-extraction", MODEL_ID, {
    device: "wasm",
    dtype: "q8",
    progress_callback: (progress) => postMessage({ type: "progress", progress }),
  });
  return extractorPromise;
}

async function embed(id, texts) {
  const extractor = await loadExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const data = Float32Array.from(output.data);
  postMessage({ type: "result", id, data, dims: output.dims }, [data.buffer]);
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === "load") {
      await loadExtractor();
      postMessage({ type: "ready" });
    } else if (msg.type === "embed") {
      await embed(msg.id, msg.texts);
    } else {
      throw new Error(`unknown message type: ${msg.type}`);
    }
  } catch (e) {
    console.error("[arctictab] embed worker:", e);
    postMessage({ type: "error", id: msg.id ?? null, message: e?.message || String(e) });
  }
};
