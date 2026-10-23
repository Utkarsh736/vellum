package app.vellum.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import app.vellum.core.CoreBridge
import app.vellum.core.BookFormat
import app.vellum.core.Book
import app.vellum.core.VellumException
import app.vellum.core.extractEpubMetadata
import app.vellum.core.extractPdfMetadata
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException

/**
 * All library mutations and SAF plumbing in one place.
 *
 * Android cannot hand a `content://` URI to the Rust core — SAF documents
 * must be read through the ContentResolver. Import therefore:
 *  1. reads the document bytes in memory (never writing a copy to disk),
 *  2. extracts metadata with the core's free functions,
 *  3. stores the *URI* in the library (the core re-opens through us).
 */
class LibraryRepository(private val context: Context) {

    private val library get() = CoreBridge.library

    suspend fun books(): List<Book> = withContext(Dispatchers.IO) {
        library.getLibrary()
    }

    suspend fun addFromUri(uri: Uri): Book = withContext(Dispatchers.IO) {
        val name = queryDisplayName(uri)
            ?: uri.lastPathSegment?.substringAfterLast('/')
            ?: "book"
        val ext = name.substringAfterLast('.', "").lowercase()

        val metadata = when (ext) {
            "epub" -> extractEpubMetadata(readBytes(uri), name)
            "pdf" -> extractPdfMetadata(readBytes(uri), name)
            else -> throw VellumException.UnsupportedFormat(path = uri.toString())
        }

        val book = library.addBook(uri.toString(), metadata, null)

        // EPUB covers come from the extracted metadata (core caches them).
        // PDFs have none — render page 1 with PdfRenderer and hand it back.
        if (book.format == BookFormat.PDF && book.coverPath == null) {
            renderPdfCover(uri, book.id)
        }

        // Re-read so the returned record carries cover_path.
        library.getBook(book.id) ?: book
    }

    suspend fun remove(book: Book) = withContext(Dispatchers.IO) {
        library.removeBook(book.id, true)
    }

    suspend fun updateProgress(bookId: Long, location: String, percent: Double) =
        withContext(Dispatchers.IO) {
            library.updateProgress(bookId, location, percent)
        }

    /** SAF permission revoked / file moved: re-point the row at a fresh URI. */
    suspend fun updateBookPath(bookId: Long, newUri: Uri) = withContext(Dispatchers.IO) {
        library.updateBookPath(bookId, newUri.toString())
    }

    // ------------------------------------------------------------------ //

    private fun readBytes(uri: Uri): ByteArray =
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IOException("ContentResolver returned no stream for $uri")

    private fun queryDisplayName(uri: Uri): String? =
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    /**
     * PDF page 1 → JPEG → core cover cache. Best-effort: failures never
     * block an otherwise successful import.
     */
    private fun renderPdfCover(uri: Uri, bookId: Long) {
        try {
            context.contentResolver.openFileDescriptor(uri, "r")?.let { pfd ->
                try {
                    val renderer = PdfRenderer(pfd)
                    try {
                        renderer.openPage(0).let { page ->
                            try {
                                val scale = 2f
                                val w = (page.width * scale).toInt().coerceAtMost(2048)
                                val h = (page.height * scale).toInt().coerceAtMost(2048)
                                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                                bmp.eraseColor(Color.WHITE)
                                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                val out = ByteArrayOutputStream()
                                bmp.compress(Bitmap.CompressFormat.JPEG, 82, out)
                                bmp.recycle()
                                CoreBridge.library.setCover(bookId, out.toByteArray(), "jpg")
                            } finally {
                                page.close()
                            }
                        }
                    } finally {
                        renderer.close()
                    }
                } finally {
                    pfd.close()
                }
            }
        } catch (_: Exception) {
            // Cover generation is decorative — ignore.
        }
    }
}
