//! Standalone `uniffi-bindgen` binary.
//!
//! Built only with `--features cli` (see `Cargo.toml`). Typical usage, from
//! `core-lib/`:
//!
//! ```text
//! cargo run --features cli --bin uniffi-bindgen -- \
//!     generate --library target/release/libvellum_core.so \
//!     --language kotlin --config ./uniffi.toml --out-dir ../generated/kotlin
//! ```

fn main() {
    uniffi::uniffi_bindgen_main()
}
