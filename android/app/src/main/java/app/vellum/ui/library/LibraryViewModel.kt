package app.vellum.ui.library

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.vellum.core.Book
import app.vellum.core.VellumException
import app.vellum.data.LibraryRepository
import kotlinx.coroutines.launch

enum class LibraryFilter { ALL, READING, FINISHED }

class LibraryViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = LibraryRepository(app)

    var books by mutableStateOf<List<Book>>(emptyList())
        private set

    var loading by mutableStateOf(true)
        private set

    /** One-shot messages for snackbar/toast (null = none). */
    var message by mutableStateOf<String?>(null)
        private set

    init {
        refresh()
    }

    fun consumeMessage() {
        message = null
    }

    fun refresh() {
        viewModelScope.launch {
            loading = true
            try {
                books = repo.books()
            } catch (e: Exception) {
                message = e.message ?: "Couldn't load the library"
            } finally {
                loading = false
            }
        }
    }

    /**
     * Import a SAF document: take the persistable URI permission (so
     * readers can re-open the file later), then extract + store metadata.
     */
    fun add(uri: Uri) {
        viewModelScope.launch {
            try {
                try {
                    getApplication<Application>().contentResolver
                        .takePersistableUriPermission(
                            uri,
                            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                } catch (_: SecurityException) {
                    // Some providers don't offer persistable grants;
                    // reading the document right now still works.
                }
                val book = repo.addFromUri(uri)
                message = getApplication<Application>().getString(
                    app.vellum.R.string.toast_added,
                    book.title,
                )
            } catch (e: VellumException.BookAlreadyExists) {
                message = getApplication<Application>()
                    .getString(app.vellum.R.string.toast_already_in_library)
            } catch (e: VellumException.UnsupportedFormat) {
                message = getApplication<Application>()
                    .getString(app.vellum.R.string.toast_unsupported)
            } catch (e: Exception) {
                message = getApplication<Application>().getString(
                    app.vellum.R.string.toast_import_failed,
                    e.message ?: e.javaClass.simpleName,
                )
            } finally {
                refresh()
            }
        }
    }

    fun remove(book: Book) {
        viewModelScope.launch {
            try {
                repo.remove(book)
                message = getApplication<Application>().getString(
                    app.vellum.R.string.toast_removed,
                    book.title,
                )
            } catch (e: Exception) {
                message = e.message ?: "Couldn't remove the book"
            } finally {
                refresh()
            }
        }
    }
}
