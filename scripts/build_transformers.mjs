// Builds vendor/transformers/transformers.js from the Transformers.js source,
// bound to ONNX Runtime's CPU-only WebAssembly build.
//
// The published bundle hardwires `onnxruntime-web/webgpu`, whose runtime file
// (ort-wasm-simd-threaded.jsep.wasm, 21.6 MB) carries WebGPU support that
// arctictab never uses (device: "wasm"). The CPU-only runtime is 11.2 MB, and
// Firefox keeps the compiled machine code of whichever one loads.
import { build } from "esbuild";

const ORT_ALIAS = "#onnxruntime-webgpu";
const ORT_CPU_ONLY = "onnxruntime-web/wasm";
// Node-only modules. The official browser bundle replaces them with empty
// objects too; Transformers.js checks for that and skips the Node code paths.
const NODE_ONLY = ["fs", "path", "url", "sharp", "onnxruntime-node"];

const nodeOnlyFilter = new RegExp(`^(${NODE_ONLY.join("|")})$`);

const browserOnly = {
  name: "arctictab-browser-only",
  setup(b) {
    b.onResolve({ filter: new RegExp(`^${ORT_ALIAS}$`) }, (args) =>
      b.resolve(ORT_CPU_ONLY, { kind: args.kind, resolveDir: args.resolveDir }));
    b.onResolve({ filter: nodeOnlyFilter }, (args) => ({ path: args.path, namespace: "node-only" }));
    b.onLoad({ filter: /.*/, namespace: "node-only" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

const result = await build({
  entryPoints: ["node_modules/@huggingface/transformers/src/transformers.js"],
  outfile: "vendor/transformers/transformers.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "firefox134",
  minify: true,
  legalComments: "eof",
  plugins: [browserOnly],
  metafile: true,
  logLevel: "warning",
});

const inputs = Object.keys(result.metafile.inputs);
const jsep = inputs.filter((p) => p.includes("jsep") || p.includes("webgpu"));
if (jsep.length) throw new Error(`WebGPU runtime code was bundled: ${jsep.join(", ")}`);
if (!inputs.some((p) => p.includes("onnxruntime-web/dist/ort.wasm"))) {
  throw new Error("the CPU-only ONNX Runtime (onnxruntime-web/wasm) was not bundled");
}
console.log(`built vendor/transformers/transformers.js from ${inputs.length} modules (CPU-only ONNX Runtime)`);
