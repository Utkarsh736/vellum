# Build the Vellum core for Android and drop the .so files into jniLibs.
#
# Requirements (host machine): Rust toolchain, cargo-ndk, Android NDK with
# clang/lld (usually via ANDROID_HOME / NDK_HOME env).
#
#   cargo install cargo-ndk
#   rustup target add aarch64-linux-android x86_64-linux-android
#   ./scripts/build-android-core.sh
set -euo pipefail
cd "$(dirname "$0")/../core-lib"

TARGETS=(aarch64-linux-android x86_64-linux-android)
OUT="../android/app/src/main/jniLibs"

for target in "${TARGETS[@]}"; do
  echo "==> cargo-ndk build ($target)…"
  cargo ndk -t "$target" -o "$OUT" build --release --lib
done

echo "==> Installed libraries:"
find "$OUT" -name "libvellum_core.so" -exec ls -lh {} \;
