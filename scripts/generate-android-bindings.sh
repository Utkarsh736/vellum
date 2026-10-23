#!/usr/bin/env bash
# Generate the Kotlin bindings for the Android app.
#
# Runs on your dev machine — binding generation only reads the UniFFI
# metadata from the built library, so the host architecture is fine.
# (The actual Android .so is cross-compiled separately with cargo-ndk —
# see core-lib/README.md.)

set -euo pipefail
cd "$(dirname "$0")/../core-lib"

echo "==> Building core-lib (release, cdylib)…"
cargo build --release --lib

# Locate the built cdylib. The repo is a Cargo workspace, so artifacts land
# in the *workspace* target/ dir; ../target/ is checked first, target/ is a
# fallback for standalone (pre-workspace) checkouts.
LIB=""
for candidate in \
  ../target/release/libvellum_core.so \
  ../target/release/libvellum_core.dylib \
  ../target/release/vellum_core.dll \
  target/release/libvellum_core.so \
  target/release/libvellum_core.dylib \
  target/release/vellum_core.dll; do
  if [ -f "$candidate" ]; then LIB="$candidate"; break; fi
done
if [ -z "$LIB" ]; then
  echo "error: built cdylib not found under target/release/" >&2
  exit 1
fi

echo "==> Generating Kotlin bindings from $LIB…"
cargo run --features cli --bin uniffi-bindgen -- generate \
  --library "$LIB" \
  --language kotlin \
  --config ./uniffi.toml \
  --out-dir ../generated/kotlin

echo "==> Done: $(pwd)/../generated/kotlin"
