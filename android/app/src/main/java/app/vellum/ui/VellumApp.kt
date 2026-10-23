package app.vellum.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import app.vellum.core.Book
import app.vellum.core.BookFormat
import app.vellum.ui.library.LibraryScreen
import app.vellum.ui.reader.EpubReaderScreen
import app.vellum.ui.reader.PdfReaderScreen

/** Simple state-based navigation — three screens, no nav library needed. */
sealed interface Screen {
    data object Library : Screen
    data class PdfReader(val book: Book) : Screen
    data class EpubReader(val book: Book) : Screen
}

@Composable
fun VellumApp() {
    var screen by remember { mutableStateOf<Screen>(Screen.Library) }

    when (val current = screen) {
        is Screen.Library -> LibraryScreen(
            onOpen = { book ->
                screen = if (book.format == BookFormat.PDF) {
                    Screen.PdfReader(book)
                } else {
                    Screen.EpubReader(book)
                }
            },
        )

        is Screen.PdfReader -> PdfReaderScreen(
            book = current.book,
            onBack = { screen = Screen.Library },
        )

        is Screen.EpubReader -> EpubReaderScreen(
            book = current.book,
            onBack = { screen = Screen.Library },
        )
    }
}
