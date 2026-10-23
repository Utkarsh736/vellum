package app.vellum

import android.app.Application
import app.vellum.core.CoreBridge

/**
 * Process entry point: initializes the shared Rust core.
 *
 * The core owns the SQLite library database and the cover cache directory
 * (`context.cacheDir/covers`) — both live in standard, OS-managed locations.
 */
class VellumApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CoreBridge.init(this)
    }
}
