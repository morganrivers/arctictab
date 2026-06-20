#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
VER="3.0.2"
URL="https://cdn.jsdelivr.net/npm/@huggingface/transformers@${VER}/dist/transformers.min.js"
curl -L -o vendor/transformers/transformers.min.js "$URL"
echo "transformers.js ${VER} fetched."
