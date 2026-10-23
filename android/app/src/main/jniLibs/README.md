# Native libraries

Place the cross-compiled Vellum core here before building the app:

    jniLibs/arm64-v8a/libvellum_core.so    (physical devices)
    jniLibs/x86_64/libvellum_core.so       (emulator)

Build both from the repo root with the helper script:

    ../scripts/build-android-core.sh

(or see android/README.md for the manual cargo-ndk commands).
