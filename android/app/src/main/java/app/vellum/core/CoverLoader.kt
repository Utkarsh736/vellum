package app.vellum.core

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Cover thumbnail loader for the library grid.
 *
 * Covers are plain files in the OS cache dir (path from the core's Book
 * record). A small LruCache keeps the last ~24 MB of decoded bitmaps;
 * misses are downsampled straight from disk (no third-party image library,
 * no network loader — privacy rule #1).
 */
object CoverLoader {

    private val cache = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    suspend fun load(path: String, reqWidth: Int): Bitmap? =
        withContext(Dispatchers.IO) {
            cache.get(path)?.let { return@withContext it }

            // Bounds-only pass to compute the sample size.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null

            var sample = 1
            while (bounds.outWidth / (sample * 2) >= reqWidth) sample *= 2

            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            val bmp = BitmapFactory.decodeFile(path, opts) ?: return@withContext null
            cache.put(path, bmp)
            bmp
        }

    fun evictAll() = cache.evictAll()
}
