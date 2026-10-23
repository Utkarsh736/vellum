# Vellum Android

Kotlin + Jetpack Compose + Material 3 frontend for Vellum. Loads the shared Rust core via UniFFI / JNA and opens books in place through the Storage Access Framework (SAF).

## Requirements

- JDK 17
- Android SDK (minSdk 26, targetSdk 35) and NDK
- Rust 1.77+ with Android targets
- [cargo-ndk](https://github.com/bbqsrc/cargo-ndk)

```bash
cargo install cargo-ndk
rustup target add aarch64-linux-android x86_64-linux-android
```

Set `ANDROID_HOME` (and ensure the NDK is installed via SDK Manager).

## Build the native core

From the **repository root**:

```bash
./scripts/build-android-core.sh
```

This places:

```text
android/app/src/main/jniLibs/arm64-v8a/libvellum_core.so
android/app/src/main/jniLibs/x86_64/libvellum_core.so
```

(Physical devices use arm64; emulators often use x86_64.)

## Build the app

```bash
# Android Studio: File → Open → select the android/ directory

# Or command line (first run may need the Gradle wrapper):
cd android
./gradlew :app:assembleDebug
```

## Project structure

```text
android/
├── app/src/main/
│   ├── java/app/vellum/
│   │   ├── core/         UniFFI bindings · CoreBridge · CoverLoader
│   │   ├── data/         LibraryRepository (SAF import, PDF covers)
│   │   ├── ui/
│   │   │   ├── theme/    Paper Design tokens (light/dark)
│   │   │   ├── library/  LazyVerticalGrid shelf, search
│   │   │   └── reader/   PDF (PdfRenderer) · EPUB (WebView + epub.js)
│   │   └── util/         Locator JSON (shared with desktop)
│   ├── assets/epub/      epub.min.js + hardened reader.html
│   ├── res/font/         Montserrat + PT Mono
│   └── jniLibs/          libvellum_core.so (from build script)
└── gradle/               Version catalog
```

## Regenerating UniFFI bindings

After changing the core’s exported API:

```bash
# From repo root
./scripts/generate-android-bindings.sh
cp generated/kotlin/app/vellum/core/vellum_core.kt \
   android/app/src/main/java/app/vellum/core/vellum_core.kt
```

## Privacy notes

- Manifest requests **no permissions** (not even `INTERNET`).
- Books open via SAF `content://` URIs; files are not copied into app storage.
- EPUB WebView: JS enabled for epub.js only; assets via `WebViewAssetLoader`; strict CSP in `reader.html`.
- `allowBackup="false"` keeps the library out of cloud backups.

See [docs/PRIVACY.md](../docs/PRIVACY.md).
