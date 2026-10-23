//! Data records shared with both frontends.
//!
//! These map 1:1 to the columns the privacy rules permit us to persist —
//! nothing here carries book content.

use serde::{Deserialize, Serialize};

/// Supported book container formats (v1 scope).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    Pdf,
    Epub,
}

impl BookFormat {
    /// Stable string used in the SQLite `format` column.
    pub fn as_str(self) -> &'static str {
        match self {
            BookFormat::Pdf => "pdf",
            BookFormat::Epub => "epub",
        }
    }

    /// Parse the SQLite `format` column back into the enum.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pdf" => Some(BookFormat::Pdf),
            "epub" => Some(BookFormat::Epub),
            _ => None,
        }
    }
}

/// Raw cover image extracted from a book container (EPUB) or rendered by a
/// frontend (PDF page 1). Bytes are passed through verbatim — the core never
/// decodes images, keeping it lightweight.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CoverImage {
    /// Raw image bytes exactly as stored in the book container.
    pub bytes: Vec<u8>,
    /// IANA media type, e.g. `image/jpeg`.
    pub media_type: String,
}

/// Metadata extracted from a book container.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct BookMetadata {
    pub format: BookFormat,
    /// Display title; never empty (falls back to the file name).
    pub title: String,
    pub author: Option<String>,
    /// Embedded cover, when the container advertises one.
    pub cover: Option<CoverImage>,
}

/// One library entry — exactly the columns the privacy rules allow, joined
/// with reading progress for the library grid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub author: Option<String>,
    pub format: BookFormat,
    /// Absolute filesystem path (desktop) or SAF `content://` URI (Android).
    pub file_path: String,
    /// Cached cover thumbnail inside the OS cache dir, if one was stored.
    pub cover_path: Option<String>,
    /// Most recent reading location (PDF page ref / EPUB CFI), if opened.
    pub last_read_location: Option<String>,
    /// Reading completion `0.0..=1.0`, if opened (joined from progress).
    pub progress_percent: Option<f64>,
    /// Unix epoch milliseconds.
    pub date_added: i64,
}

/// Reading progress for one book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ReadingProgress {
    pub book_id: i64,
    /// Platform-specific locator, e.g. `pdf:page=12` or `epub:cfi=/6/4!/4/2`.
    pub location: String,
    /// Completion `0.0..=1.0`.
    pub percent: f64,
    /// Unix epoch milliseconds of the last update.
    pub updated_at: i64,
}
