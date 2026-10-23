# Vellum Core (`vellum-core`)

The shared, local-first heart of Vellum. Owns **data, never UI**: the SQLite
library database, PDF/EPUB metadata extraction, cover caching, and UniFFI
bindings for Android.

- **Crate:** `vellum-core` · **Library:** `vellum_core` (lib + cdylib + staticlib)
- **Toolchain:** Rust 2021 edition, verified with rustc 1.99 / cargo 1.99
- **Status:** Step 1 complete — `cargo test` green (17 tests), Kotlin bindings generated

## Privacy guarantees (by construction)

| Rule | How the core enforces it |
|---|---|
| Zero telemetry / offline | No HTTP client anywhere in the dependency tree. Nothing to phone home with. |
| Minimal storage | Two tables, only the permitted columns (below). |
| No full-text storage | No text-extraction code exists in the core. `lopdf` reads only the Info dictionary; the EPUB parser reads only `container.xml` + the OPF package metadata. |
| Ephemeral caches | Covers live in `<cache_dir>/covers/<book-id>.<ext>` — the OS-purgeable cache directory, never app data. Cover write failures never fail an import. |
| No file copies | `add_book` reads from the path/URI and stores only the reference. `remove_book` deletes only the DB row (+ optional cached cover), never the book. |

## Database schema

```sql
CREATE TABLE books (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    author      TEXT,
    format      TEXT    NOT NULL CHECK (format IN ('pdf','epub')),
    file_path   TEXT    NOT NULL UNIQUE,   -- path (desktop) or content:// URI (Android)
    cover_path  TEXT,                      -- inside the OS cache dir
    date_added  INTEGER NOT NULL           -- unix epoch ms
);

CREATE TABLE reading_progress (            -- the spec's "last_read_location"
    book_id    INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    location   TEXT    NOT NULL,           -- e.g. "pdf:page=12" / "epub:cfi=/6/4!/4/2"
    percent    REAL    NOT NULL CHECK (percent >= 0.0 AND percent <= 1.0),
    updated_at INTEGER NOT NULL
);
```

WAL journal mode + `synchronous=NORMAL` for smooth debounced writes;
`foreign_keys=ON` so progress cascade-deletes with its book. `get_library()`
returns books `LEFT JOIN`ed with progress so the grid gets everything in one
call.

## API

### `VellumLibrary(dbPath, cacheDir)` — the main object

| Method | Signature | Notes |
|---|---|---|
| `new` | `(db_path: String, cache_dir: String)` | Opens/creates the DB, runs migrations, creates `covers/`. |
| `add_book` | `(path_or_uri, provided_metadata?, title_override?) → Book` | Desktop: pass `None` metadata (core reads the file). Android SAF: pass `Some(metadata)` extracted from ContentResolver bytes. Duplicate paths → `BookAlreadyExists`. |
| `get_library` | `() → Vec<Book>` | Newest first, progress joined. |
| `get_book` | `(id) → Book?` | |
| `remove_book` | `(id, delete_cover: bool)` | Book file is never touched. |
| `update_progress` | `(book_id, location, percent)` | Upsert; percent clamped to `0.0..=1.0` (NaN → 0.0); empty location rejected. |
| `get_progress` | `(book_id) → ReadingProgress?` | |
| `clear_progress` | `(book_id)` | "Mark as unread". |
| `set_cover` | `(book_id, bytes, extension) → cache_path` | For PDF page-1 thumbnails rendered by the frontend. |
| `book_file_exists` | `(book) → bool` | Greys out missing files; `content://` always true. |

### Free functions (no library needed)

| Function | Purpose |
|---|---|
| `extract_epub_metadata(bytes, source_name) → BookMetadata` | `container.xml` → OPF → title/author/cover. EPUB 3 `properties="cover-image"` and EPUB 2 `<meta name="cover">` both supported; tolerates percent-encoded and case-mismatched zip entry names. |
| `extract_pdf_metadata(bytes, source_name) → BookMetadata` | Trailer `Info` dict (Title/Author), UTF-16BE + PDFDocEncoding decode. Encrypted PDFs skip the dict (garbage risk) and fall back to the file name. Cover is `None` — frontends render page 1 and call `set_cover`. |
| `extract_metadata_from_path(path)` | Desktop convenience: detect by extension, read, extract. |

`source_name` is only used for the fallback title when the file has none.
Titles are never empty. Errors are the `VellumError` enum (`Io`, `Database`,
`UnsupportedFormat`, `BookAlreadyExists`, `CorruptFile`, `BookNotFound`,
`InvalidArgument`) — a Kotlin sealed class on Android, JSON `{"kind": ...}`
on desktop.

## Android integration (Step 3)

Generated bindings live at `../generated/kotlin/app/vellum/core/vellum_core.kt`
(regenerate with `../scripts/generate-android-bindings.sh`). Usage:

```kotlin
import app.vellum.core.VellumLibrary
import app.vellum.core.Book
import app.vellum.core.extractEpubMetadata

// once at app start (paths from Android context)
val library = VellumLibrary(
    dbPath   = context.getDatabasePath("vellum.db").absolutePath,
    cacheDir = context.cacheDir.absolutePath,
)

// importing a book picked via ACTION_OPEN_DOCUMENT:
contentResolver.openInputStream(uri).use { stream ->
    val bytes = stream!!.readBytes()
    val meta = extractEpubMetadata(bytes, "display-name.epub")  // or extractPdfMetadata
    val book: Book = library.addBook(uri.toString(), meta, null)
    // takePersistableUriPermission(uri, ...) so the reader can re-open it
}

val books: List<Book> = library.getLibrary()
library.updateProgress(book.id, "epub:cfi=/6/4!/4/2", 0.35)
```

Setup required in the Android project:
1. Cross-compile the `.so` with [cargo-ndk](https://github.com/bbqsrc/cargo-ndk):
   ```bash
   cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 \
     -o <android-app>/src/main/jniLibs build --release --lib
   ```
   (The `cli` feature is off by default, keeping the Android binary free of
   clap and other dev-only deps.)
2. Add the JNA dependency (`net.java.dev.jna:jna@5.14.0` or newer, the AAR
   flavor) — the generated bindings load `libvellum_core.so` through it.
3. Copy `generated/kotlin/app/vellum/core/` into your Kotlin sources.

## Desktop integration (Step 2 preview)

Tauri uses the crate directly as a path dependency — no FFI, no serialization
glue (all records already derive `serde::Serialize`):

```rust
// src-tauri/src/lib.rs (Step 2)
use vellum_core::{VellumLibrary, Book};
use std::sync::Arc;

#[tauri::command]
fn get_library(state: tauri::State<'_, Arc<VellumLibrary>>) -> Result<Vec<Book>, vellum_core::VellumError> {
    state.get_library()
}
```

## Building and testing

```bash
cargo test                    # 17 integration tests, no network, no fixtures on disk
cargo build --release --lib   # build the core (desktop dep + host .so for bindgen)
../scripts/generate-android-bindings.sh   # regenerate Kotlin bindings
```

Test fixtures are built in memory: a real EPUB zip (mimetype, container.xml,
OPF with both EPUB 2 and EPUB 3 cover styles, chapter, JPEG bytes) and a real
PDF (assembled with lopdf itself, including UTF-16BE title variants).

## Design decisions worth knowing

- **Why `provided_metadata` on `add_book`?** SAF `content://` URIs cannot be
  opened by the Rust core on Android — only the JVM ContentResolver can. The
  Kotlin layer reads the bytes once, extracts metadata, and hands it over.
  Desktop passes `None` and lets the core do everything.
- **Why doesn't the core render PDF covers?** Rendering requires a full PDF
  rasterizer (huge). pdf.js (desktop) and `PdfRenderer` (Android) already
  render page 1 for free; they hand the bytes to `set_cover`.
- **Why `percent` clamping instead of errors?** Real readers emit tiny
  overshoot at book end (`1.0000001`). Progress is display data, not
  financial data — clamp and move on.
- **Why rusqlite sync + Mutex?** Single-user, local-first app. An async
  runtime would add complexity and binary size for zero benefit at this
  scale. Tauri commands can wrap calls in `spawn_blocking` if ever needed.
- **Why local-name XML matching?** EPUBs in the wild use assorted namespace
  prefixes (`dc:`, `opf:`, none). Matching local names (`title`, `creator`)
  with metadata/manifest context is strictly more compatible than exact
  qualified-name matching.
