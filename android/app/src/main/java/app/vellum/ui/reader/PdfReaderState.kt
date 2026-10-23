package app.vellum.ui.reader

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.vellum.core.Book
import app.vellum.core.CoreBridge
import app.vellum.util.PROGRESS_DEBOUNCE_MS
import app.vellum.util.Locators
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PDF reader engine (Step 4): owns the PdfRenderer + a ±1 page bitmap
 * window, and persists progress with the shared 1.2 s debounce.
 *
 * PdfRenderer is not thread-safe — every renderer call happens behind
 * [renderLock] on a single dispatcher.
 */
class PdfReaderState(
    private val context: Context,
    val book: Book,
    private val onUpdate: (Book) -> Unit,
) {
    var pageCount by mutableIntStateOf(0)
        private set

    /** Human-facing failure; null while things are fine. */
    var error by mutableStateOf<String?>(null)
        private set

    /** True when the SAF permission was revoked — offer re-pick. */
    var permissionLost by mutableStateOf(false)
        private set

    var opening by mutableStateOf(true)
        private set

    /** page bitmaps currently materialized (indices), value null = pending */
    val bitmaps = mutableStateMapOf<Int, Bitmap>()

    private var pfd: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private val renderLock = Any()
    private val closed = AtomicBoolean(false)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var progressJob: Job? = null
    private var lastSettledPage = Locators.parse(book.lastReadLocation).page?.minus(1) ?: 0

    /** Start loading. Safe to call once after construction. */
    fun open() {
        if (!closed.get()) scope.launch(Dispatchers.IO) { openInternal() }
    }

    private fun openInternal() {
        try {
            val uri = Uri.parse(book.filePath)
            val fd = context.contentResolver.openFileDescriptor(uri, "r")
                ?: throw IOException("ContentResolver returned no descriptor")
            synchronized(renderLock) {
                pfd = fd
                val r = PdfRenderer(fd)
                renderer = r
                pageCount = r.pageCount
            }
            val startPage = lastSettledPage.coerceIn(0, pageCount - 1)
            withContext(Dispatchers.Main) {
                opening = false
                error = null
                permissionLost = false
            }
            renderWindow(startPage)
        } catch (e: SecurityException) {
            failed(permissionLost = true, message = null)
        } catch (e: Exception) {
            failed(permissionLost = false, message = e.message ?: e.javaClass.simpleName)
        }
    }

    private fun failed(permissionLost: Boolean, message: String?) {
        if (closed.get()) return
        scope.launch(Dispatchers.Main) {
            opening = false
            this@PdfReaderState.permissionLost = permissionLost
            error = message
        }
    }

    /** Render the current page and its neighbors into the bitmap window. */
    fun renderWindow(center: Int) {
        if (closed.get()) return
        lastSettledPage = center
        for (page in listOf(center - 1, center, center + 1)) {
            if (page !in 0 until pageCount) continue
            if (bitmaps.containsKey(page)) continue
            scope.launch(Dispatchers.IO) { renderPageInternal(page) }
        }
        // Evict pages outside the window to bound memory.
        val window = listOf(center - 1, center, center + 1)
        bitmaps.keys.filter { it !in window }.forEach { bitmaps.remove(it) }
        scheduleProgress(center)
    }

    private fun renderPageInternal(page: Int) {
        if (closed.get()) return
        try {
            val bitmap = synchronized(renderLock) {
                val r = renderer ?: return
                r.openPage(page).let { p ->
                    try {
                        // Render at 2x for crisp pinch-zoom; cap extreme sizes.
                        val scale = 2f
                        val w = (p.width * scale).toInt().coerceAtMost(2048)
                        val h = (p.height * scale).toInt().coerceAtMost(2048)
                        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(Color.WHITE)
                        p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp
                    } finally {
                        p.close()
                    }
                }
            } ?: return
            if (closed.get()) return
            scope.launch(Dispatchers.Main) { bitmaps[page] = bitmap }
        } catch (_: Exception) {
            // Renderer closed mid-flight — ignore.
        }
    }

    // ---- Progress (Step 4 contract) --------------------------------------

    private fun scheduleProgress(page: Int) {
        if (closed.get() || pageCount == 0) return
        progressJob?.cancel()
        progressJob = scope.launch {
            delay(PROGRESS_DEBOUNCE_MS)
            saveProgress(page)
        }
    }

    private suspend fun saveProgress(page: Int) {
        if (closed.get()) return
        lastSettledPage = page
        val location = Locators.pdf(page + 1, pageCount)
        val percent = (page + 1).toDouble() / pageCount
        try {
            CoreBridge.library.updateProgress(book.id, location, percent)
            withContext(Dispatchers.Main) { onUpdate(book) }
        } catch (_: Exception) {
            // Progress is best-effort; never block reading.
        }
    }

    /** Force the pending save (back navigation, onPause). */
    fun flush() {
        val pending = progressJob
        progressJob = null
        pending?.cancel()
        if (closed.get()) return
        scope.launch { saveProgress(lastSettledPage) }
    }

    /** Re-pick flow: refresh the URI when the user chose a different one. */
    fun reopenWith(newUri: Uri?) {
        scope.launch(Dispatchers.IO) {
            try {
                if (newUri != null && newUri.toString() != book.filePath) {
                    CoreBridge.library.updateBookPath(book.id, newUri.toString())
                }
                closeRenderer()
                withContext(Dispatchers.Main) {
                    opening = true
                    error = null
                    permissionLost = false
                    bitmaps.clear()
                }
                openInternal()
            } catch (e: Exception) {
                failed(permissionLost = false, message = e.message)
            }
        }
    }

    private fun closeRenderer() {
        synchronized(renderLock) {
            try {
                renderer?.close()
            } catch (_: Exception) {
            }
            renderer = null
            try {
                pfd?.close()
            } catch (_: Exception) {
            }
            pfd = null
        }
    }

    /** Final teardown — flushes, closes renderer, cancels the scope. */
    fun close() {
        if (!closed.compareAndSet(false, true)) return
        progressJob?.cancel()
        // best-effort synchronous flush on the IO dispatcher
        runBlocking {
            withTimeoutOrNull(800) {
                saveProgress(lastSettledPage)
            }
        }
        scope.cancel()
        closeRenderer()
    }
}
