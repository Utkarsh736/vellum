# Vellum Privacy Audit

The product spec's privacy rules, and where each one is enforced. This is a
structural audit: the rules hold because the code *cannot* violate them, not
because of runtime promises.

## Rule 1 — Zero telemetry, zero network

| Layer      | Enforcement                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Rust core  | No HTTP/TCP dependency anywhere in `core-lib`'s tree (rusqlite, lopdf, zip, quick-xml, uniffi).       |
| Desktop    | CSP in `tauri.conf.json` + `index.html` lists **no remote origin** in any directive. The only Tauri plugins are core + the native file dialog. No updater, no analytics. Fonts (Montserrat/Roboto/PT Mono) and pdf.js/epub.js are bundled by Vite from npm — nothing is fetched at runtime. |
| Android    | **No `INTERNET` permission** (and no other permission) in the manifest — the OS blocks sockets entirely. WebView content additionally sits behind a `default-src 'none'` CSP. |

## Rule 2 — Minimal database schema

The SQLite schema (`core-lib/src/db.rs`) has exactly two tables:

- `books(id, title, author, format, file_path, cover_path, date_added)`
- `reading_progress(book_id, location, percent, updated_at)`

There is no content column, no full-text index, and no cache of book text.
Reading locations are opaque JSON locators (page numbers / EPUB CFIs).

## Rule 3 — Book files are never copied

- Desktop: `read_book_file` streams the file from its original path as raw
  IPC bytes; nothing is written to app storage.
- Android: SAF documents are read through `ContentResolver` streams; the
  stored reference is the `content://` URI itself. The EPUB engine feeds
  bytes *in memory* into the WebView — never via a temp file.

## Rule 4 — Covers live in the OS cache dir

Covers are written to `<os-cache>/covers/<book-id>.<ext>`:

- macOS: `~/Library/Caches/app.vellum/covers/`
- Android: `context.cacheDir/covers/`

The OS may purge them at any time; the UI falls back to format-branded
placeholders. Removing a book deletes its cover; a failed cover write never
fails an import.

## Rule 5 — WebView containment (Android)

`EpubReaderState` configures the reader WebView with:

- `javaScriptEnabled` — required by epub.js; the *only* enabled capability
- `domStorageEnabled = false`, `databaseEnabled = false`
- `allowFileAccess = false`, `allowContentAccess = false`
- content served via `WebViewAssetLoader` (https origin), not `file://`
- epub.js `allowScriptedContent: false` — EPUB-embedded scripts never run
- `reader.html` CSP: `default-src 'none'`, `connect-src 'none'`

## Backups and system data

- Android: `android:allowBackup="false"` — the library DB is excluded from
  cloud/device backups.
- Desktop: no auto-start, no URL handlers, no file associations in v1.

## What Vellum stores, complete list

1. `~/Library/Application Support/app.vellum/library.db` (macOS) /
   `<app_dir>/app_vellum/library.db` (Android) — the two tables above.
2. Cover thumbnails in the OS cache dir (purgeable).
3. Reader UI preferences in `localStorage` (desktop: theme, font size) and
   `SharedPreferences` (Android: font size).

That's everything. No logs, no crash reports, no identifiers.
