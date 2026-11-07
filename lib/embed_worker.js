// The one copy of the embedding model, shared by every arctictab page (sidebar,
// background, options) as a SharedWorker. lib/modelhost.js decides when it
// closes itself; lib/embed.js is the page side.
import { pipeline, env } from "../vendor/transformers/transformers.js";
import { ModelHost } from "./modelhost.js";
import { MODEL_IDLE_UNLOAD_MINUTES, OPTIONS_DEFAULTS } from "./options.js";

const VENDOR_URL = new URL("../vendor/transformers/", import.meta.url).href;
const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = VENDOR_URL + "models/";
env.backends.onnx.wasm.wasmPaths = VENDOR_URL + "wasm/";
env.backends.onnx.wasm.numThreads = 1;
// This worker already keeps inference off the pages' threads.
env.backends.onnx.wasm.proxy = false;

const host = new ModelHost({
  load: (onProgress) => pipeline("feature-extraction", MODEL_ID, { device: "wasm", dtype: "q8", progress_callback: onProgress }),
  embed: async (extractor, texts) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return { data: Float32Array.from(output.data), dims: output.dims };
  },
  close: () => self.close(),
  idleMs: MODEL_IDLE_UNLOAD_MINUTES * 60 * 1000,
  unloadWhenIdle: OPTIONS_DEFAULTS.unloadModelWhenIdle,
});

self.onconnect = (e) => host.connect(e.ports[0]);
