//! SQLite layer — schema, migrations and every query the core runs.
//!
//! Schema design notes (privacy rules #2 and #3):
//! - `books` carries exactly the permitted columns, nothing more.
//! - `reading_progress` is the spec's `last_read_location`, promoted to its
//!   own table keyed by `book_id` so it can be updated cheaply on every
//!   debounced save and cascade-deleted with the book.
//! - There is deliberately **no** text/content column anywhere: the contents
//!   of books are never indexed.

use std::fs;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Result, VellumError};
use crate::models::{Book, BookFormat, ReadingProgress};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS books (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    author      TEXT,
    format      TEXT    NOT NULL CHECK (format IN ('pdf', 'epub')),
    file_path   TEXT    NOT NULL UNIQUE,
    cover_path  TEXT,
    date_added  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_progress (
    book_id    INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    location   TEXT    NOT NULL,
    percent    REAL    NOT NULL CHECK (percent >= 0.0 AND percent <= 1.0),
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_date_added ON books (date_added DESC);
";

/// Open (or create) the library database and make sure the schema exists.
pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| VellumError::Io {
                path: parent.to_string_lossy().into_owned(),
                message: e.to_string(),
            })?;
        }
    }
    let conn = Connection::open(path).map_err(|e| VellumError::Io {
        path: path.to_string_lossy().into_owned(),
        message: e.to_string(),
    })?;
    // WAL keeps reader/writer concurrency smooth for debounced progress saves.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    // FK enforcement makes progress cascade-delete with its book.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn book_path_exists(conn: &Connection, file_path: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM books WHERE file_path = ?1",
        params![file_path],
        |row| row.get(0),
    )?;
    Ok(n > 0)
}

pub fn insert_book(
    conn: &Connection,
    title: &str,
    author: Option<&str>,
    format: BookFormat,
    file_path: &str,
    date_added: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO books (title, author, format, file_path, date_added)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![title, author, format.as_str(), file_path, date_added],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn set_cover_path(conn: &Connection, id: i64, cover_path: &str) -> Result<()> {
    conn.execute(
        "UPDATE books SET cover_path = ?1 WHERE id = ?2",
        params![cover_path, id],
    )?;
    Ok(())
}

/// Point a book row at a new path/URI (desktop: file moved on disk;
/// Android: SAF permission re-granted). Returns whether a row changed.
pub fn update_book_path(conn: &Connection, id: i64, new_path: &str) -> Result<bool> {
    let affected = conn.execute(
        "UPDATE books SET file_path = ?1 WHERE id = ?2",
        params![new_path, id],
    )?;
    Ok(affected > 0)
}

const BOOK_COLUMNS: &str = "b.id, b.title, b.author, b.format, b.file_path, \
                            b.cover_path, b.date_added, p.location, p.percent";

fn row_to_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<Book> {
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        author: row.get(2)?,
        // The CHECK constraint guarantees a known value; the fallback is
        // purely defensive for a hand-edited database.
        format: BookFormat::parse(&row.get::<_, String>(3)?).unwrap_or(BookFormat::Epub),
        file_path: row.get(4)?,
        cover_path: row.get(5)?,
        date_added: row.get(6)?,
        last_read_location: row.get(7)?,
        progress_percent: row.get(8)?,
    })
}

pub fn get_book(conn: &Connection, id: i64) -> Result<Option<Book>> {
    let sql = format!(
        "SELECT {BOOK_COLUMNS} FROM books b \
         LEFT JOIN reading_progress p ON p.book_id = b.id \
         WHERE b.id = ?1"
    );
    conn.query_row(&sql, params![id], row_to_book)
        .optional()
        .map_err(VellumError::from)
}

/// All books, newest first, joined with progress for the library grid.
pub fn list_books(conn: &Connection) -> Result<Vec<Book>> {
    let sql = format!(
        "SELECT {BOOK_COLUMNS} FROM books b \
         LEFT JOIN reading_progress p ON p.book_id = b.id \
         ORDER BY b.date_added DESC, b.id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_book)?;
    let mut books = Vec::new();
    for book in rows {
        books.push(book?);
    }
    Ok(books)
}

/// Delete a book row; the progress row cascades via the FK.
/// Returns whether a row was actually removed.
pub fn delete_book(conn: &Connection, id: i64) -> Result<bool> {
    let affected = conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
    Ok(affected > 0)
}

pub fn upsert_progress(
    conn: &Connection,
    book_id: i64,
    location: &str,
    percent: f64,
    updated_at: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO reading_progress (book_id, location, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(book_id) DO UPDATE SET
            location   = excluded.location,
            percent    = excluded.percent,
            updated_at = excluded.updated_at",
        params![book_id, location, percent, updated_at],
    )?;
    Ok(())
}

pub fn get_progress(conn: &Connection, book_id: i64) -> Result<Option<ReadingProgress>> {
    conn.query_row(
        "SELECT book_id, location, percent, updated_at FROM reading_progress
         WHERE book_id = ?1",
        params![book_id],
        |row| {
            Ok(ReadingProgress {
                book_id: row.get(0)?,
                location: row.get(1)?,
                percent: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(VellumError::from)
}

pub fn delete_progress(conn: &Connection, book_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM reading_progress WHERE book_id = ?1",
        params![book_id],
    )?;
    Ok(())
}
