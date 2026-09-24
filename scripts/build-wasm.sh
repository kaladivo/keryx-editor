#!/usr/bin/env bash
# Builds public/keryx.wasm from wasm/ and copies Go's wasm_exec.js next to it.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd wasm && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o ../public/keryx.wasm .)

goroot=$(go env GOROOT)
exec_js="$goroot/lib/wasm/wasm_exec.js"
[ -f "$exec_js" ] || exec_js="$goroot/misc/wasm/wasm_exec.js"
cp "$exec_js" public/wasm_exec.js

ls -l public/keryx.wasm public/wasm_exec.js
