package app.vellum.ui.reader

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.webkit.WebViewAssetLoader
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
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * EPUB reader engine (Step 4): hardened WebView + epub.js, byte-fed in
 * chunks from the SAF document (the book is never written to disk).
 *
 * Hardening summary:
 *  - assets served through WebViewAssetLoader (https origin), file/content
 *    access disabled in the WebView settings;
 *  - reader.html CSP blocks every remote origin (and the app has no
 *    INTERNET permission at all);
 *  - EPUB-internal scripts disabled (allowScriptedContent:false).
 */
class EpubReaderState(
    private val context: Context,
    val book: Book,
    private val onUpdate: () -> Unit = {},
) {
    var ready by mutableStateOf(false)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    var permissionLost by mutableStateOf(false)
        private set

    var fontSize by mutableStateOf(loadFontSize())
        private set

    /** Mirrors the Compose theme; pushed into the WebView on change. */
    var dark by mutableStateOf(false)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val closed = AtomicBoolean(false)
    private var webView: WebView? = null
    private var htmlLoaded = false
    private var bytesReady = false
    private var started = false
    private var progressJob: Job? = null

    private val savedCfi: String? = Locators.parse(book.lastReadLocation).cfi

    // ---- WebView lifecycle -------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun attach(view: WebView) {
        webView = view

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = false
            databaseEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_DEFAULT
            // The reader is fixed-content; text zoom is handled by our own control.
            textZoom = 100
        }
        view.setBackgroundColor(Color.TRANSPARENT)
        view.isVerticalScrollBarEnabled = false

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(url: String?, isMainFrame: Boolean) {
                if (isMainFrame) {
                    htmlLoaded = true
                    maybeStart()
                }
            }
        }

        view.addJavascriptInterface(Bridge(), "VellumBridge")

        // Privacy: no devtools on release builds.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            @Suppress("DEPRECATION")
            WebView.setWebContentsDebuggingEnabled(false)
        }

        view.loadUrl(READER_URL)

        // Kick off the byte feed in parallel.
        scope.launch(Dispatchers.IO) { loadBytes() }
    }

    fun detach() {
        webView?.apply {
            loadUrl("about:blank")
            destroy()
        }
        webView = null
    }

    // ---- Byte feeding -------------------------------------------------------

    private fun loadBytes() {
        try {
            val uri = Uri.parse(book.filePath)
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw java.io.IOException("ContentResolver returned no stream")

            if (closed.get()) return

            // Base64 chunks of ~400 KB — evaluateJavascript strings must
            // stay comfortably under the binder/IPC limits.
            val CHUNK = 300_000
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val total = (b64.length + CHUNK - 1) / CHUNK

            withContext(Dispatchers.Main) {
                val view = webView ?: return@withContext
                for (i in 0 until total) {
                    val slice = b64.substring(i * CHUNK, minOf((i + 1) * CHUNK, b64.length))
                    view.evaluateJavascript("window.__vlFeed($i,'$slice');", null)
                }
                bytesReady = true
                maybeStart()
            }
        } catch (e: SecurityException) {
            scope.launch(Dispatchers.Main) { permissionLost = true }
        } catch (e: Exception) {
            scope.launch(Dispatchers.Main) { error = e.message ?: e.javaClass.simpleName }
        }
    }

    private fun maybeStart() {
        if (started || !htmlLoaded || !bytesReady) return
        started = true
        val cfiJs = savedCfi?.let { "'$it'" } ?: "null"
        webView?.evaluateJavascript(
            "window.__vlStart($cfiJs, $fontSize, $dark);",
            null,
        )
    }

    // ---- Commands ------------------------------------------------------------

    fun nextPage() = eval("window.__vlNext();")
    fun prevPage() = eval("window.__vlPrev();")

    fun setFontSize(size: Int) {
        fontSize = size.coerceIn(14, 26)
        saveFontSize(fontSize)
        eval("window.__vlSetAppearance($fontSize, $dark);")
    }

    fun setDark(value: Boolean) {
        dark = value
        eval("window.__vlSetAppearance($fontSize, $dark);")
    }

    private fun eval(js: String) {
        if (started) webView?.evaluateJavascript(js, null)
    }

    // ---- Progress (Step 4 contract) ------------------------------------------

    private inner class Bridge {
        @JavascriptInterface
        fun onReady() {
            scope.launch(Dispatchers.Main) { ready = true }
        }

        @JavascriptInterface
        fun onRelocated(cfi: String, percent: Double) {
            // Called on the JavaBridge thread — hop to main, debounce, save.
            scope.launch(Dispatchers.Main) {
                lastCfi = cfi
                lastPercent = percent
                progressJob?.cancel()
                progressJob = scope.launch {
                    delay(PROGRESS_DEBOUNCE_MS)
                    writeProgress()
                }
            }
        }

        @JavascriptInterface
        fun onError(message: String) {
            scope.launch(Dispatchers.Main) { error = message }
        }
    }

    private var lastCfi: String? = null
    private var lastPercent = 0.0

    private suspend fun writeProgress() {
        val cfi = lastCfi ?: return
        if (closed.get()) return
        try {
            CoreBridge.library.updateProgress(book.id, Locators.epub(cfi), lastPercent)
            onUpdate()
        } catch (_: Exception) {
            // best-effort
        }
    }

    /** Cancel the debounce timer and write immediately (back navigation). */
    fun flush() {
        progressJob?.cancel()
        progressJob = null
        scope.launch { writeProgress() }
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        progressJob?.cancel()
        // Best-effort synchronous flush before the scope dies.
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.withTimeoutOrNull(800) { writeProgress() }
        }
        scope.cancel()
    }

    // ---- Font size persistence -----------------------------------------------

    private fun loadFontSize(): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getInt(KEY_FONT, 18)

    private fun saveFontSize(size: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putInt(KEY_FONT, size).apply()
    }

    companion object {
        private const val PREFS = "vellum.reader"
        private const val KEY_FONT = "fontSize"
        private const val READER_URL =
            "https://appassets.androidplatform.net/assets/epub/reader.html"
    }
}
