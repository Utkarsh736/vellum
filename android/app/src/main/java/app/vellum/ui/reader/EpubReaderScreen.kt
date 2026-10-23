package app.vellum.ui.reader

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import android.webkit.WebView
import app.vellum.R
import app.vellum.core.Book
import kotlinx.coroutines.launch

/**
 * EPUB reader screen: hardened WebView (see EpubReaderState) with the
 * Paper reading theme, font-size controls and page-turn buttons.
 */
@Composable
fun EpubReaderScreen(book: Book, onBack: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val state = remember(book.id) { EpubReaderState(context, book) }
    val systemDark = isSystemInDarkTheme()
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    LaunchedEffect(systemDark) { state.setDark(systemDark) }

    val repick = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                try {
                    context.contentResolver.takePersistableUriPermission(
                        uri,
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                } catch (_: SecurityException) {
                }
                // Same document re-picked → just permission refresh.
                // A different document → re-point the library row, then the
                // user reopens from the shelf with progress intact.
                if (uri.toString() != book.filePath) {
                    try {
                        app.vellum.core.CoreBridge.library
                            .updateBookPath(book.id, uri.toString())
                    } catch (_: Exception) {
                    }
                }
                onBack()
            }
        }
    }

    DisposableEffect(book.id) {
        onDispose { state.close() }
    }

    BackHandler {
        state.flush()
        onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = {
                        state.flush()
                        onBack()
                    }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.cd_back),
                        )
                    }
                },
                title = {
                    Column {
                        Text(
                            text = book.title,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = book.author
                                ?: stringResource(R.string.unknown_author),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                actions = {
                    // Font size controls (Paper: A− / A+), 48dp targets.
                    IconButton(
                        onClick = { state.setFontSize(state.fontSize - 1) },
                        modifier = Modifier.semantics {
                            contentDescription = "Smaller text"
                        },
                    ) {
                        Text("A−", style = MaterialTheme.typography.labelLarge)
                    }
                    IconButton(
                        onClick = { state.setFontSize(state.fontSize + 1) },
                        modifier = Modifier.semantics {
                            contentDescription = "Larger text"
                        },
                    ) {
                        Text(
                            "A+",
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                state.permissionLost -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        stringResource(R.string.reader_permission_lost),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = { repick.launch(arrayOf("application/epub+zip")) },
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text(stringResource(R.string.reader_repick))
                    }
                }

                state.error != null -> Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        stringResource(R.string.reader_open_failed, state.error!!),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error,
                    )
                }

                else -> {
                    AndroidView(
                        factory = { ctx -> WebView(ctx).also { state.attach(it) } },
                        onRelease = { state.detach() },
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (!state.ready) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    }

                    // Page-turn affordance (48dp targets, bottom corners).
                    Row(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .padding(bottom = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        IconButton(
                            onClick = { state.prevPage() },
                            modifier = Modifier.semantics {
                                contentDescription = "Previous page"
                            },
                        ) {
                            Icon(Icons.Filled.ChevronLeft, contentDescription = null)
                        }
                        IconButton(
                            onClick = { state.nextPage() },
                            modifier = Modifier.semantics {
                                contentDescription = "Next page"
                            },
                        ) {
                            Icon(Icons.Filled.ChevronRight, contentDescription = null)
                        }
                    }
                }
            }
        }
    }
}
