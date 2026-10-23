# Keep the UniFFI-generated bindings (reflection-free, but JNA callback
# signatures and record fields must survive any future R8 run).
-keep class app.vellum.core.** { *; }
-keep class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**
