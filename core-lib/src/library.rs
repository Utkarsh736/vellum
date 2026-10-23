//! `VellumLibrary` — the main object both frontends talk to.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};

use crate::db;
use crate::error::{Result, VellumError};
use crate::metadata;
use crate::models::{Book, BookFormat, BookMetadata, ReadingProgress};

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The library database + cover cache, shared by both frontends.
///
/// All methods are thread-safe: a single SQLite connection behind a `Mutex`.
/// UniFFI hands out an `Arc<VellumLibrary>` on Android; Tauri holds one in
/// managed state on desktop.
#[derive(Debug, uniffi::Object)]
pub struct VellumLibrary {
    conn: Mutex<Connection>,
    covers_dir: PathBuf,
}

#[uniffi::export]
impl VellumLibrary {
    /// Open (or create) a library database.
    ///
    /// - `db_path`: e.g. `<app_data_dir>/vellum.db`
    /// - `cache_dir`: the OS-provided *cache* directory. Covers are written
    ///   to `<cache_dir>/covers/<book-id>.<ext>` — safe for the OS to purge
    ///   at any time (privacy rule #4). The core never writes anything else
    ///   to disk.
    #[uniffi::constructor]
    pub fn new(db_path: String, cache_dir: String) -> std::result::Result<Self, VellumError> {
        let conn = db::open(Path::new(&db_path))?;
        let covers_dir = Path::new(&cache_dir).join("covers");
        fs::create_dir_all(&covers_dir).map_err(|e| VellumError::Io {
            path: covers_dir.to_string_lossy().into_owned(),
            message: e.to_string(),
        })?;
        Ok(Self {
            conn: Mutex::new(conn),
            covers_dir,
        })
    }

    /// Add a book to the library. The book file itself is never copied.
    ///
    /// - **Desktop**: pass `provided_metadata = None` — the core reads the
    ///   file at `path_or_uri` (a real filesystem path) and extracts the
    ///   metadata itself.
    /// - **Android (SAF)**: open the `content://` URI through the
    ///   ContentResolver, extract metadata with the free functions
    ///   (`extract_epub_metadata` / `extract_pdf_metadata`), then pass
    ///   `Some(metadata)` so the core never needs filesystem access to the
    ///   URI. Take a persistable URI permission so the reader can re-open it
    ///   later.
    ///
    /// `title_override` (optional) wins over the extracted title — used by
    /// the UI for user renames.
    pub fn add_book(
        &self,
        path_or_uri: String,
        provided_metadata: Option<BookMetadata>,
        title_override: Option<String>,
    ) -> std::result::Result<Book, VellumError> {
        let metadata = match provided_metadata {
            Some(m) => m,
            None => {
                let format = metadata::detect_format(&path_or_uri).ok_or_else(|| {
                    VellumError::UnsupportedFormat {
                        path: path_or_uri.clone(),
                    }
                })?;
                let bytes = fs::read(&path_or_uri).map_err(|e| VellumError::Io {
                    path: path_or_uri.clone(),
                    message: e.to_string(),
                })?;
                match format {
                    BookFormat::Pdf => metadata::pdf::extract(&bytes, &path_or_uri)?,
                    BookFormat::Epub => metadata::epub::extract(&bytes, &path_or_uri)?,
                }
            }
        };

        let conn = self.lock()?;
        if db::book_path_exists(&conn, &path_or_uri)? {
            return Err(VellumError::BookAlreadyExists {
                path: path_or_uri,
            });
        }

        let title = title_override
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .unwrap_or(metadata.title);
        let author = metadata.author.filter(|a| !a.trim().is_empty());
        let date_added = now_millis();
        let id = db::insert_book(
            &conn,
            &title,
            author.as_deref(),
            metadata.format,
            &path_or_uri,
            date_added,
        )?;

        // Cover caching is best-effort: a full cache dir must never fail
        // an otherwise-successful import.
        if let Some(cover) = metadata.cover {
            let ext = ext_for_media_type(&cover.media_type);
            if let Ok(path) = self.write_cover_file(id, &cover.bytes, ext) {
                let _ = db::set_cover_path(&conn, id, &path);
            }
        }

        db::get_book(&conn, id)?.ok_or(VellumError::BookNotFound { id })
    }

    /// All books, newest first, joined with reading progress for the grid.
    pub fn get_library(&self) -> std::result::Result<Vec<Book>, VellumError> {
        let conn = self.lock()?;
        db::list_books(&conn)
    }

    /// Fetch a single book by id.
    pub fn get_book(
        &self,
        book_id: i64,
    ) -> std::result::Result<Option<Book>, VellumError> {
        let conn = self.lock()?;
        db::get_book(&conn, book_id)
    }

    /// Remove a book from the library. The book file itself is never touched.
    /// `delete_cover` also removes the cached cover thumbnail.
    pub fn remove_book(
        &self,
        book_id: i64,
        delete_cover: bool,
    ) -> std::result::Result<(), VellumError> {
        let conn = self.lock()?;
        let book = db::get_book(&conn, book_id)?.ok_or(VellumError::BookNotFound {
            id: book_id,
        })?;
        if delete_cover {
            if let Some(cover) = &book.cover_path {
                // Purgeable cache: a missing file is fine.
                let _ = fs::remove_file(cover);
            }
        }
        db::delete_book(&conn, book_id)?;
        Ok(())
    }

    /// Persist reading progress. Called by the readers' debounced save
    /// (Step 4) and on book close.
    ///
    /// `percent` is clamped to `0.0..=1.0` (readers can emit slight
    /// overshoot at the end of a book); non-finite values become `0.0`.
    /// An empty `location` is rejected.
    pub fn update_progress(
        &self,
        book_id: i64,
        location: String,
        percent: f64,
    ) -> std::result::Result<(), VellumError> {
        if location.trim().is_empty() {
            return Err(VellumError::InvalidArgument {
                message: "location must not be empty".to_string(),
            });
        }
        let percent = if percent.is_finite() {
            percent.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let conn = self.lock()?;
        db::get_book(&conn, book_id)?.ok_or(VellumError::BookNotFound {
            id: book_id,
        })?;
        db::upsert_progress(&conn, book_id, &location, percent, now_millis())
    }

    /// Current reading progress for one book.
    pub fn get_progress(
        &self,
        book_id: i64,
    ) -> std::result::Result<Option<ReadingProgress>, VellumError> {
        let conn = self.lock()?;
        db::get_progress(&conn, book_id)
    }

    /// Forget reading progress for a book ("mark as unread").
    pub fn clear_progress(&self, book_id: i64) -> std::result::Result<(), VellumError> {
        let conn = self.lock()?;
        db::get_book(&conn, book_id)?.ok_or(VellumError::BookNotFound {
            id: book_id,
        })?;
        db::delete_progress(&conn, book_id)
    }

    /// Store a rendered cover (e.g. PDF page 1 rendered by the frontend)
    /// into the cache dir. Returns the cache path.
    ///
    /// PDFs carry no embedded raster cover the core can copy out, so the
    /// platform renderer produces the thumbnail and hands it back.
    pub fn set_cover(
        &self,
        book_id: i64,
        image_bytes: Vec<u8>,
        extension: String,
    ) -> std::result::Result<String, VellumError> {
        let conn = self.lock()?;
        let book = db::get_book(&conn, book_id)?.ok_or(VellumError::BookNotFound {
            id: book_id,
        })?;
        let ext = sanitize_ext(&extension);
        let new_path = self.covers_dir.join(format!("{book_id}.{ext}"));

        // Drop a previous cover file if it would otherwise be orphaned.
        if let Some(old) = &book.cover_path {
            let old_path = Path::new(old);
            if old_path != new_path {
                let _ = fs::remove_file(old_path);
            }
        }

        let path_str = self.write_cover_file(book_id, &image_bytes, &ext)?;
        db::set_cover_path(&conn, book_id, &path_str)?;
        Ok(path_str)
    }

    /// Re-point a book at a new path/URI, keeping its id, progress and cover.
    ///
    /// Two front-end flows use this:
    /// - **Desktop**: the user moved the file on disk, picked the new
    ///   location via "Locate file…".
    /// - **Android**: the persistable SAF permission was revoked (reboot,
    ///   cloud sync, manual revoke); the user re-picks the same document and
    ///   the stored `content://` URI is refreshed.
    ///
    /// The path's existence is *not* validated — `content://` URIs cannot be
    /// checked from the core. The caller verifies it can actually open the
    /// book before offering the update.
    pub fn update_book_path(
        &self,
        book_id: i64,
        new_path: String,
    ) -> std::result::Result<Book, VellumError> {
        let new_path = new_path.trim().to_string();
        if new_path.is_empty() {
            return Err(VellumError::InvalidArgument {
                message: "new path must not be empty".to_string(),
            });
        }
        let conn = self.lock()?;
        conn.query_row(
            "SELECT file_path FROM books WHERE id = ?1",
            rusqlite::params![book_id],
            |row| row.get::<_, String>(0),
        )
        .optional()? // rusqlite::Error → VellumError via From
        .ok_or(VellumError::BookNotFound { id: book_id })?;

        // The UNIQUE constraint on file_path must not be violated by a
        // cross-book collision — surface it as the domain error it is.
        let collision: Option<i64> = conn
            .query_row(
                "SELECT id FROM books WHERE file_path = ?1 AND id != ?2",
                rusqlite::params![new_path, book_id],
                |row| row.get(0),
            )
            .optional()?;
        if collision.is_some() {
            return Err(VellumError::BookAlreadyExists { path: new_path });
        }

        db::update_book_path(&conn, book_id, &new_path)?;
        db::get_book(&conn, book_id)?.ok_or(VellumError::BookNotFound { id: book_id })
    }

    /// Best-effort existence check so the UI can grey out missing files.
    /// SAF `content://` URIs are reported as existing — they must be
    /// resolved by the Android ContentResolver, not by the core.
    pub fn book_file_exists(&self, book: &Book) -> bool {
        if book.file_path.starts_with("content://") {
            return true;
        }
        Path::new(&book.file_path).exists()
    }
}

impl VellumLibrary {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| VellumError::Database {
            message: "library mutex poisoned".to_string(),
        })
    }

    fn write_cover_file(&self, book_id: i64, bytes: &[u8], ext: &str) -> Result<String> {
        let path = self.covers_dir.join(format!("{book_id}.{ext}"));
        fs::write(&path, bytes).map_err(|e| VellumError::Io {
            path: path.to_string_lossy().into_owned(),
            message: e.to_string(),
        })?;
        Ok(path.to_string_lossy().into_owned())
    }
}

fn sanitize_ext(raw: &str) -> String {
    let ext: String = raw
        .trim()
        .trim_start_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();
    if ext.is_empty() {
        "img".to_string()
    } else {
        ext
    }
}

fn ext_for_media_type(media_type: &str) -> &'static str {
    match media_type.trim().to_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "img",
    }
}
