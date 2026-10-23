package app.vellum.core

import android.content.Context
import java.io.File

/**
 * Process-wide handle to the shared Rust core (libvellum_core.so via JNA).
 *
 * The single [VellumLibrary] instance is thread-safe (SQLite behind a mutex
 * inside the core), so every layer — repository, readers, cover renderer —
 * can call it directly from any dispatcher.
 */
object CoreBridge {

    @Volatile
    private var libraryRef: VellumLibrary? = null

    val library: VellumLibrary
        get() = libraryRef ?: throw IllegalStateException(
            "CoreBridge.init(context) must run before touching the library",
        )

    @Synchronized
    fun init(context: Context) {
        if (libraryRef != null) return
        // databases dir: <filesDir>/../app_vellum — private, never backed up.
        val dataDir = context.getDir("vellum", Context.MODE_PRIVATE)
        val dbPath = File(dataDir, "library.db").absolutePath
        // Covers live in the OS cache dir — the system may purge them any
        // time (privacy rule #4); the library degrades gracefully.
        val cacheDir = context.cacheDir.absolutePath
        libraryRef = VellumLibrary(dbPath, cacheDir)
    }

    /** For tests / future multi-window scenarios. */
    @Synchronized
    fun resetForTest() {
        libraryRef?.destroy()
        libraryRef = null
    }
}
