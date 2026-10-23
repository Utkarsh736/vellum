package app.vellum.util

import org.json.JSONObject

/**
 * Reading-location serialization — the same JSON locator contract as the
 * desktop readers (docs/READING_ENGINE.md):
 *
 *   PDF : {"type":"pdf","page":12,"total":240}
 *   EPUB: {"type":"epub","cfi":"epubcfi(/6/4!/4/2)"}
 */
object Locators {

    fun pdf(page: Int, total: Int): String =
        JSONObject().put("type", "pdf").put("page", page).put("total", total).toString()

    fun epub(cfi: String): String =
        JSONObject().put("type", "epub").put("cfi", cfi).toString()

    data class Saved(val page: Int?, val cfi: String?)

    fun parse(raw: String?): Saved {
        if (raw.isNullOrBlank()) return Saved(null, null)
        return try {
            val obj = JSONObject(raw)
            when (obj.optString("type")) {
                "pdf" -> Saved(obj.optInt("page", 1).coerceAtLeast(1), null)
                "epub" -> Saved(null, obj.optString("cfi").takeIf { it.isNotBlank() })
                else -> Saved(null, null)
            }
        } catch (_: Exception) {
            Saved(null, null)
        }
    }
}

/** Shared debounce interval for progress persistence (Step 4 contract). */
const val PROGRESS_DEBOUNCE_MS = 1200L
