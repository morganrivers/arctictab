#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VENDOR="vendor/transformers"
MODEL_DIR="${VENDOR}/models/Snowflake/snowflake-arctic-embed-xs"
WASM_DIR="${VENDOR}/wasm"
ORT_DIST="node_modules/onnxruntime-web/dist"

mkdir -p "${MODEL_DIR}/onnx" "${WASM_DIR}"

npm ci

copy() {
  local src="$1"
  local dest="$2"
  [[ -s "$src" ]] || { echo "missing: $src" >&2; exit 1; }
  cp "$src" "$dest"
  echo "copied: $dest"
}

# Built from source against ONNX Runtime's CPU-only build (see the script).
node scripts/build_transformers.mjs
copy "${ORT_DIST}/ort-wasm-simd-threaded.mjs" "${WASM_DIR}/ort-wasm-simd-threaded.mjs"
copy "${ORT_DIST}/ort-wasm-simd-threaded.wasm" "${WASM_DIR}/ort-wasm-simd-threaded.wasm"
copy "node_modules/@huggingface/transformers/LICENSE" "${VENDOR}/LICENSE"

fetch() {
  local url="$1"
  local dest="$2"
  if [[ -s "$dest" ]]; then
    echo "skip (exists): $dest"
    return
  fi
  echo "fetching: $url"
  curl -fL --retry 3 -o "$dest" "$url"
}

HF_BASE="https://huggingface.co/Snowflake/snowflake-arctic-embed-xs/resolve/main"

fetch "${HF_BASE}/config.json"               "${MODEL_DIR}/config.json"
fetch "${HF_BASE}/tokenizer.json"            "${MODEL_DIR}/tokenizer.json"
fetch "${HF_BASE}/tokenizer_config.json"     "${MODEL_DIR}/tokenizer_config.json"
fetch "${HF_BASE}/special_tokens_map.json"   "${MODEL_DIR}/special_tokens_map.json"
fetch "${HF_BASE}/onnx/model_quantized.onnx" "${MODEL_DIR}/onnx/model_quantized.onnx"

echo "vendor assets ready (@huggingface/transformers built with CPU-only onnxruntime-web, snowflake-arctic-embed-xs q8)."
