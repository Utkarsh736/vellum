package app.vellum.ui.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.vellum.R
import app.vellum.core.Book

/**
 * The cover-grid library: SAF import, client-side search (in-memory only —
 * the database is never full-text indexed), Reading/Finished filters.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    onOpen: (Book) -> Unit,
    vm: LibraryViewModel = viewModel(),
) {
    var searchOpen by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf(LibraryFilter.ALL) }
    var pendingRemove by remember { mutableStateOf<Book?>(null) }
    val snackbar = remember { SnackbarHostState() }

    // SAF picker — the persistable permission is taken inside the VM
    // (it needs the application context), readers re-open the URI later.
    val pickBook = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) vm.add(uri)
    }

    LaunchedEffect(vm.message) {
        vm.message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    val visible = remember(vm.books, query, filter) {
        var list = vm.books
        when (filter) {
            LibraryFilter.READING -> list = list.filter {
                (it.progressPercent ?: 0.0) > 0.005 && (it.progressPercent ?: 0.0) < 0.995
            }
            LibraryFilter.FINISHED -> list = list.filter {
                (it.progressPercent ?: 0.0) >= 0.995
            }
            LibraryFilter.ALL -> Unit
        }
        val q = query.trim().lowercase()
        if (q.isNotEmpty()) {
            list = list.filter {
                it.title.lowercase().contains(q) ||
                    (it.author ?: "").lowercase().contains(q)
            }
        }
        list
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Vellum", style = MaterialTheme.typography.titleLarge) },
                actions = {
                    if (searchOpen) {
                        OutlinedTextField(
                            value = query,
                            onValueChange = { query = it },
                            placeholder = { Text(stringResource(R.string.search_hint)) },
                            singleLine = true,
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .padding(end = 8.dp)
                                .width(180.dp),
                        )
                    }
                    IconButton(
                        onClick = { searchOpen = !searchOpen; if (!searchOpen) query = "" },
                        modifier = Modifier.semantics {
                            contentDescription = "Search library"
                        },
                    ) {
                        Icon(Icons.Filled.Search, contentDescription = null)
                    }
                    IconButton(
                        onClick = {
                            pickBook.launch(
                                arrayOf("application/pdf", "application/epub+zip"),
                            )
                        },
                        modifier = Modifier.semantics {
                            contentDescription = "Add books to your library"
                        },
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            // Filter row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = filter == LibraryFilter.ALL,
                    onClick = { filter = LibraryFilter.ALL },
                    label = { Text(stringResource(R.string.section_all)) },
                )
                FilterChip(
                    selected = filter == LibraryFilter.READING,
                    onClick = { filter = LibraryFilter.READING },
                    label = { Text(stringResource(R.string.section_reading)) },
                )
                FilterChip(
                    selected = filter == LibraryFilter.FINISHED,
                    onClick = { filter = LibraryFilter.FINISHED },
                    label = { Text(stringResource(R.string.section_finished)) },
                )
            }

            when {
                vm.loading -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }

                vm.books.isEmpty() -> EmptyLibrary(
                    onAdd = {
                        pickBook.launch(
                            arrayOf("application/pdf", "application/epub+zip"),
                        )
                    },
                )

                visible.isEmpty() -> Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "No matches",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Nothing in this section yet",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 112.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        start = 16.dp,
                        end = 16.dp,
                        top = 8.dp,
                        bottom = 24.dp,
                    ),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(visible, key = { it.id }) { book ->
                        BookCard(
                            book = book,
                            onOpen = onOpen,
                            onRemove = { pendingRemove = it },
                        )
                    }
                }
            }

            // Privacy footer (always visible, even with books)
            if (vm.books.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Filled.Shield,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = stringResource(R.string.privacy_note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }

    pendingRemove?.let { book ->
        AlertDialog(
            onDismissRequest = { pendingRemove = null },
            title = {
                Text(stringResource(R.string.remove_title, book.title))
            },
            text = { Text(stringResource(R.string.remove_body)) },
            confirmButton = {
                TextButton(onClick = {
                    vm.remove(book)
                    pendingRemove = null
                }) {
                    Text(
                        stringResource(R.string.remove_confirm),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemove = null }) {
                    Text(stringResource(R.string.remove_cancel))
                }
            },
        )
    }
}

@Composable
private fun EmptyLibrary(onAdd: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(R.string.empty_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(R.string.empty_body),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.privacy_note),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onAdd, shape = RoundedCornerShape(10.dp)) {
            Text(stringResource(R.string.empty_cta))
        }
    }
}
