package app.vellum.ui.library

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.ui.platform.LocalDensity
import app.vellum.R
import app.vellum.core.Book
import app.vellum.core.BookFormat
import app.vellum.core.CoverLoader
import app.vellum.ui.theme.PaperViolet

/** One grid cell: cover (or format fallback), title, author, progress. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BookCard(
    book: Book,
    onOpen: (Book) -> Unit,
    onRemove: (Book) -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val coverCd = book.title

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp)) // Paper: card radius 16
            .combinedClickable(
                onClick = { onOpen(book) },
                onLongClick = { menuOpen = true },
            )
            .semantics {
                contentDescription =
                    "$coverCd, ${book.author ?: "Unknown author"}" +
                        (book.progressPercent?.let { p ->
                            if (p > 0.005 && p < 0.995) ", ${Math.round(p * 100)}% read" else ""
                        } ?: "")
            },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(16.dp)),
        ) {
            CoverImage(book = book, contentDescription = null)

            val percent = book.progressPercent
            if (percent != null && percent >= 0.995) {
                Surface(
                    color = PaperViolet,
                    contentColor = Color.White,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp),
                ) {
                    Text(
                        text = "Finished",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }

            // Overflow affordance + long-press menu.
            Box(modifier = Modifier.align(Alignment.TopEnd)) {
                IconButton(
                    onClick = { menuOpen = true },
                    modifier = Modifier
                        .graphicsLayer { alpha = 0.85f }
                        .semantics {
                            contentDescription = "Remove $coverCd"
                        },
                ) {
                    Icon(
                        Icons.Filled.MoreVert,
                        contentDescription = null,
                        tint = Color.White,
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("Remove from library…") },
                        leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            onRemove(book)
                        },
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        Text(
            text = book.title,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            text = book.author
                ?: androidx.compose.ui.res.stringResource(R.string.unknown_author),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        val percent = book.progressPercent
        if (percent != null && percent > 0.005 && percent < 0.995) {
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { percent.toFloat() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp)),
                color = PaperViolet,
                trackColor = MaterialTheme.colorScheme.outlineVariant,
            )
        }
    }
}

/** Cover bitmap from the core cache path, or a format-branded fallback. */
@Composable
private fun CoverImage(book: Book, contentDescription: String?) {
    val density = LocalDensity.current
    val reqWidth = with(density) { 128.dp.toPx().toInt() }
    val bitmap by produceState(initialValue = null as android.graphics.Bitmap?, book.coverPath) {
        value = book.coverPath?.let { CoverLoader.load(it, reqWidth) }
    }

    if (bitmap != null) {
        Image(
            bitmap = bitmap!!.asImageBitmap(),
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
    } else {
        val brush = if (book.format == BookFormat.PDF) {
            Brush.linearGradient(listOf(Color(0xFF3F3F46), Color(0xFF18181B)))
        } else {
            Brush.linearGradient(listOf(Color(0xFF8B5CF6), Color(0xFF5B21B6)))
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(brush),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = book.format.name,
                style = MaterialTheme.typography.labelMedium,
                color = Color.White.copy(alpha = 0.9f),
                textAlign = TextAlign.Center,
            )
        }
    }
}
