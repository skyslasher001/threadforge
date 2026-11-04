#!/usr/bin/env bash
# Runs the Rust Higgsfield bridge against tests/hf_mock.py (auth, upload, estimate, submit, poll, download, cancel).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tests/hf_mock.py 8787 & MOCK=$!
trap 'kill $MOCK' EXIT
sleep 0.5
cd src-tauri && THREADFORGE_HF_BASE=http://127.0.0.1:8787 cargo test --lib higgsfield -- --ignored --nocapture
